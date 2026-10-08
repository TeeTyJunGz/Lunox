/**
 * Autoplay Utility (prefetch + track finder)
 *
 * Two modes (stored on the player, per guild):
 *
 *  basedfetch (default)
 *      Always follows the song the USER chose (the "base"). When the base mix
 *      has 2 or fewer fresh songs left, lavalink is asked for the base mix
 *      AGAIN (YouTube often returns a different mix). The base is used as long
 *      as that gives MORE than 2 fresh songs. Only if it doesn't do songs from
 *      the mix / play history become temporary seeds. The base itself never
 *      drifts, and it is replaced only when the user manually plays a new song.
 *
 *  lastfetch
 *      Follows the song that is playing right now (taste can drift).
 *
 * In both modes a song that was already played this session is never picked
 * again, and history is never cleared.
 */

const { queueLoudnessAnalysis, getCacheKey, applyGainCorrection } = require("./loudness.js");
const Logger = require("./logger");

const MODES = { BASED: "basedfetch", LAST: "lastfetch" };
const DEFAULT_MODE = MODES.BASED;

const MAX_SEARCHES = 8; // max NEW lavalink searches per pick (cached mixes are free)
const TRAIL_LIMIT = 100; // remembered plays used as fallback seeds
const RECENT_BLOCK = 15; // last-resort only: block this many recent plays
const MIX_CACHE_LIMIT = 150;
const NEIGHBORS_PER_SEED = 6;
const BASE_MIN_FRESH = 2; // base mix is used only while it has MORE than this many fresh songs
const ORIGIN_LIMIT = 200;

// ---------------------------------------------------------------- helpers

function ensureState(player) {
    if (!player.playedHistory) player.playedHistory = new Set();
    if (!player.autoplayTrail) player.autoplayTrail = [];
    if (!player.autoplayPicked) player.autoplayPicked = new Set(); // keys picked by autoplay, not yet played
    if (!player.autoplayMixes) player.autoplayMixes = new Map(); // seedId -> mix tracks
    if (!player.autoplayOrigins) player.autoplayOrigins = new Map(); // trackKey -> song it was fetched from (GUI)
    if (player.autoplayStamp === undefined) player.autoplayStamp = 0;
}

function isSeedable(track) {
    return !!track?.identifier && (track.source === "youtube" || track.source === "youtubeMusic");
}

function toSeed(track, fallbackRequester) {
    return {
        identifier: track.identifier,
        requester: track.requester ?? fallbackRequester,
        key: getCacheKey(track),
        title: track?.title || "Unknown",   // ADDED: Save title for the GUI
        author: track?.author || "Unknown", // ADDED: Save artist for the GUI
    };
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function releaseReservation(player, track) {
    if (!track) return;
    const key = getCacheKey(track);
    player.playedHistory?.delete(key);
    player.autoplayPicked?.delete(key);
    player.autoplayOrigins?.delete(key);
}

/**
 * Which song was this autoplay track fetched from? (for the player GUI)
 * Returns { title, author } or null for user-added tracks.
 */
function getAutoplayOrigin(player, track) {
    if (!track || !player?.autoplayOrigins) return null;
    return player.autoplayOrigins.get(getCacheKey(track)) || null;
}

// ---------------------------------------------------------------- state API

/**
 * Call from trackStart for EVERY track that starts.
 * A track NOT picked by autoplay is a user choice -> it becomes the new base.
 */
function recordPlayed(player, track) {
    if (!track) return;
    ensureState(player);

    const key = getCacheKey(track);
    player.playedHistory.add(key);
    const wasAutoplayPick = player.autoplayPicked.delete(key);

    if (isSeedable(track)) {
        const last = player.autoplayTrail[player.autoplayTrail.length - 1];
        if (!last || last.key !== key) {
            player.autoplayTrail.push(toSeed(track));
            if (player.autoplayTrail.length > TRAIL_LIMIT) player.autoplayTrail.shift();
        }
    }

    if (!wasAutoplayPick) {
        // User chose this song -> no autoplay indicator, and it becomes the new base.
        player.autoplayOrigins.delete(key);
        // Anything prefetched is now stale.
        if (isSeedable(track)) player.autoplayBase = toSeed(track);
        player.autoplayStamp++;
        clearPrefetch(player);
    }
}

/** Enable / switch autoplay mode. baseTrack = the song the user wants to follow. */
function setAutoplayMode(player, mode, baseTrack) {
    ensureState(player);
    player.autoplayMode = mode;
    if (isSeedable(baseTrack)) player.autoplayBase = toSeed(baseTrack);
    player.autoplayStamp++;
    clearPrefetch(player);
}

function getAutoplayMode(player) {
    return player.autoplayMode || DEFAULT_MODE;
}

/** Call when autoplay is disabled. */
function resetAutoplay(player) {
    ensureState(player);
    player.autoplayMode = null;
    player.autoplayStamp++;
    clearPrefetch(player);
}

// ---------------------------------------------------------------- searching

async function searchMix(client, seed) {
    const url = `https://music.youtube.com/watch?v=${seed.identifier}&list=RD${seed.identifier}`;
    try {
        const result = await client.rainlink.search(url, { requester: seed.requester });
        return result?.tracks?.length ? result.tracks : [];
    } catch (err) {
        Logger.debug(`[Autoplay] Mix search failed for ${seed.identifier}: ${err.message}`);
        return [];
    }
}

/** Cached mix lookup. Returns { tracks, searched, skipped }. */
async function getMix(player, client, seed, allowSearch) {
    const cache = player.autoplayMixes;
    const hit = cache.get(seed.identifier);
    if (hit) return { tracks: hit, searched: false, skipped: false };
    if (!allowSearch) return { tracks: [], searched: false, skipped: true };

    const tracks = await searchMix(client, seed);
    storeMix(player, seed, tracks);
    return { tracks, searched: true, skipped: false };
}

function storeMix(player, seed, tracks) {
    if (!tracks.length) return;
    const cache = player.autoplayMixes;
    cache.delete(seed.identifier); // re-insert so it counts as newest
    cache.set(seed.identifier, tracks);
    if (cache.size > MIX_CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/** Ask lavalink again, ignoring the cache (YouTube may return a different mix). */
async function refreshMix(player, client, seed) {
    const tracks = await searchMix(client, seed);
    storeMix(player, seed, tracks);
    return tracks;
}

function pick(player, candidates, label, seed) {
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    const key = getCacheKey(picked);
    // Reserve immediately so nothing else can pick it before it plays
    player.playedHistory.add(key);
    player.autoplayPicked.add(key);
    // Remember which song this track was fetched from (shown in the GUI)
    if (seed) {
        player.autoplayOrigins.set(key, { title: seed.title, author: seed.author });
        if (player.autoplayOrigins.size > ORIGIN_LIMIT) {
            player.autoplayOrigins.delete(player.autoplayOrigins.keys().next().value);
        }
    }
    Logger.debug(`[Autoplay] ${label} picked "${picked.title.substring(0, 50)}" (${candidates.length} fresh candidates)`);
    return picked;
}

function lastResort(player, ctx, lastTracks, lastSeed) {
    if (!lastTracks.length) return null;
    const recentKeys = new Set(player.autoplayTrail.slice(-RECENT_BLOCK).map((t) => t.key));

    let pool = lastTracks.filter((t) => {
        const key = getCacheKey(t);
        return key !== ctx.currentKey && !ctx.queuedKeys.has(key) && !recentKeys.has(key);
    });
    if (!pool.length) {
        pool = lastTracks.filter((t) => {
            const key = getCacheKey(t);
            return key !== ctx.currentKey && !ctx.queuedKeys.has(key);
        });
    }
    if (!pool.length) return null;

    Logger.warn(`[Autoplay] Nothing unplayed reachable, reusing an older track`);
    return pick(player, pool, "last-resort", lastSeed);
}

// ---------------------------------------------------------------- modes

async function findBased(player, client, ctx) {
    let base = player.autoplayBase;
    if (!base?.identifier) {
        const cur = player.queue.current;
        if (isSeedable(cur)) base = toSeed(cur);
        else base = player.autoplayTrail[player.autoplayTrail.length - 1];
    }
    if (!base) return null;

    const visited = new Set([base.identifier]);
    let searches = 0;
    let lastTracks = [];
    let lastSeed = base;

    // ---- Step 1: the user's base song comes first, always.
    const first = await getMix(player, client, base, true);
    if (first.searched) searches++;
    let baseTracks = first.tracks;
    let baseFresh = baseTracks.filter((t) => !ctx.isBlocked(t));

    // Few fresh songs left in the cached mix -> ask lavalink for the base mix AGAIN.
    // YouTube often returns a different mix the next time, so new songs can show up.
    if (baseFresh.length <= BASE_MIN_FRESH && !first.searched) {
        const again = await refreshMix(player, client, base);
        searches++;
        if (again.length) {
            baseTracks = again;
            baseFresh = baseTracks.filter((t) => !ctx.isBlocked(t));
        }
        Logger.debug(`[Autoplay] Base mix refreshed: ${baseFresh.length} fresh of ${baseTracks.length}`);
    }

    // More than 2 fresh songs -> stay on the base, never touch the mix songs.
    if (baseFresh.length > BASE_MIN_FRESH) {
        return pick(player, baseFresh, "basedfetch(base)", base);
    }

    // ---- Step 2: base is (nearly) exhausted -> songs from its mix become the seeds.
    if (baseTracks.length) {
        lastTracks = baseTracks;
        lastSeed = base;
    }

    const frontier = [];
    let added = 0;
    for (const t of shuffle(baseTracks)) {
        if (added >= NEIGHBORS_PER_SEED) break;
        if (!t.identifier || visited.has(t.identifier)) continue;
        visited.add(t.identifier);
        frontier.push(toSeed(t, base.requester));
        added++;
    }

    let trailAdded = false;

    while (true) {
        if (!frontier.length) {
            // Related mixes exhausted too -> fall back to play history as seeds
            if (trailAdded) break;
            trailAdded = true;
            for (const s of shuffle(player.autoplayTrail).slice(0, 30)) {
                if (!visited.has(s.identifier)) {
                    visited.add(s.identifier);
                    frontier.push(s);
                }
            }
            continue;
        }

        const seed = frontier.shift();
        const { tracks, searched, skipped } = await getMix(player, client, seed, searches < MAX_SEARCHES);
        if (skipped) continue;
        if (searched) searches++;
        if (!tracks.length) continue;
        lastTracks = tracks;
        lastSeed = seed;

        const candidates = tracks.filter((t) => !ctx.isBlocked(t));
        if (candidates.length) {
            return pick(player, candidates, "basedfetch(related)", seed);
        }

        // This mix is fully played too: go one level deeper
        let n = 0;
        for (const t of shuffle(tracks)) {
            if (n >= NEIGHBORS_PER_SEED) break;
            if (!t.identifier || visited.has(t.identifier)) continue;
            visited.add(t.identifier);
            frontier.push(toSeed(t, base.requester));
            n++;
        }
    }

    // Related seeds found nothing: use the 1-2 leftover fresh songs of the base
    if (baseFresh.length) {
        return pick(player, baseFresh, "basedfetch(base-leftover)", base);
    }

    return lastResort(player, ctx, lastTracks, lastSeed);
}

async function findLast(player, client, ctx) {
    const frontier = [];
    const visited = new Set();
    const push = (seed) => {
        if (!seed?.identifier || visited.has(seed.identifier)) return;
        visited.add(seed.identifier);
        frontier.push(seed);
    };

    const current = player.queue.current;
    if (isSeedable(current)) push(toSeed(current));
    for (let i = player.autoplayTrail.length - 1; i >= 0; i--) push(player.autoplayTrail[i]);
    if (!frontier.length) return null;

    const fallbackRequester = frontier[0].requester;
    let searches = 0;
    let lastTracks = [];
    let lastSeed = frontier[0];

    while (frontier.length) {
        const seed = frontier.shift();
        const { tracks, searched, skipped } = await getMix(player, client, seed, searches < MAX_SEARCHES);
        if (skipped) continue;
        if (searched) searches++;
        if (!tracks.length) continue;
        lastTracks = tracks;
        lastSeed = seed;

        const candidates = tracks.filter((t) => !ctx.isBlocked(t));
        if (candidates.length) return pick(player, candidates, "lastfetch", seed);

        for (const t of shuffle(tracks).slice(0, 4)) push(toSeed(t, fallbackRequester));
    }

    return lastResort(player, ctx, lastTracks, lastSeed);
}

/**
 * Find the next autoplay track according to the player's autoplay mode.
 * @returns {Promise<Object|null>}
 */
async function findNextAutoplayTrack(player, client) {
    ensureState(player);

    const current = player.queue.current;
    const currentKey = current ? getCacheKey(current) : null;
    const queuedKeys = new Set(Array.from(player.queue).map((t) => getCacheKey(t)));

    const ctx = {
        currentKey,
        queuedKeys,
        isBlocked: (t) => {
            const key = getCacheKey(t);
            return key === currentKey || queuedKeys.has(key) || player.playedHistory.has(key);
        },
    };

    return getAutoplayMode(player) === MODES.LAST
        ? findLast(player, client, ctx)
        : findBased(player, client, ctx);
}

// ---------------------------------------------------------------- prefetch

function preFetchNextAutoplayTrack(player, client) {
    if (player._prefetchPromise) return player._prefetchPromise;

    const run = async () => {
        try {
            ensureState(player);
            if (!client.data.get("autoplay", player.guildId)) return;
            if (player.nextAutoplayTrack) return;

            // Songs the USER queued still come first. Prefetch only when none are left,
            // so the base is always the user's final song.
            const userQueued = Array.from(player.queue).filter((t) => !player.autoplayPicked.has(getCacheKey(t))).length;
            if (userQueued > 0) return;

            const stamp = player.autoplayStamp;
            const nextTrack = await findNextAutoplayTrack(player, client);
            if (!nextTrack) return;

            // Disabled / mode switched / user played a new song while we were searching
            if (!client.data.get("autoplay", player.guildId) || stamp !== player.autoplayStamp) {
                releaseReservation(player, nextTrack);
                return;
            }

            player.nextAutoplayTrack = nextTrack;

            queueLoudnessAnalysis(nextTrack, () => {
                if (player.queue.current && getCacheKey(player.queue.current) === getCacheKey(nextTrack)) {
                    applyGainCorrection(player, player.queue.current, client);
                }
            });

            Logger.info(`[AutoplayPrefetch] Pre-fetched (${getAutoplayMode(player)}): ${nextTrack.title}`);
        } catch (error) {
            Logger.error(`[AutoplayPrefetch] Failed:`, error.message);
        }
    };

    const promise = run();
    player._prefetchPromise = promise;
    promise.finally(() => {
        if (player._prefetchPromise === promise) player._prefetchPromise = null;
    });
    return promise;
}

/** Drop the prefetched track and release its reservation so it can be picked later. */
function clearPrefetch(player) {
    if (player.nextAutoplayTrack) {
        releaseReservation(player, player.nextAutoplayTrack);
        player.nextAutoplayTrack = null;
    }
}

module.exports = {
    MODES,
    DEFAULT_MODE,
    preFetchNextAutoplayTrack,
    findNextAutoplayTrack,
    recordPlayed,
    setAutoplayMode,
    getAutoplayMode,
    getAutoplayOrigin,
    resetAutoplay,
    clearPrefetch,
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */