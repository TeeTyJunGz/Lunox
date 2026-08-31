/**
 * Autoplay Pre-fetch Utility
 *
 * While a track is playing, search for and analyze the next autoplay track
 * so it's ready when the current track ends. This eliminates the gap where
 * the next track would play without loudness correction.
 */

const { queueLoudnessAnalysis, getCacheKey } = require("./loudness.js");
const Logger = require("./logger");

/**
 * Pre-fetch the next autoplay track and start its loudness analysis.
 * Called when current track starts playing (if autoplay enabled and queue <= 1).
 *
 * @param {Object} player - Rainlink player instance
 * @param {Object} client - Discord client instance
 */
async function preFetchNextAutoplayTrack(player, client) {
    // Guard: prevent concurrent pre-fetches for the same guild
    if (player._prefetchInProgress) {
        return;
    }
    player._prefetchInProgress = true;

    try {
        // Guard: only pre-fetch if autoplay is enabled
        const isAutoplayEnabled = client.data.get("autoplay", player.guildId);
        if (!isAutoplayEnabled) {
            return;
        }

        // Guard: don't pre-fetch if user has manually queued multiple tracks
        if (player.queue.size > 1) {
            return;
        }

        // Guard: don't pre-fetch if already have a pre-fetched track waiting
        if (player.nextAutoplayTrack) {
            return;
        }

        // Use current track if no previous track yet (mid-song pre-fetch)
        const previousTrack = player.queue.previous[0] || player.queue.current;
        if (!previousTrack) {
            return;
        }

        // Search for RD-mix candidates (same logic as queueEmpty.js)
        const getTrack = `https://music.youtube.com/watch?v=${previousTrack.identifier}&list=RD${previousTrack.identifier}`;
        const result = await client.rainlink.search(getTrack, { requester: previousTrack.requester });

        if (!result || !result.tracks || !result.tracks.length) {
            return;
        }

        // Initialize played history if not already
        if (!player.playedHistory) {
            player.playedHistory = new Set();
        }

        // Filter out already-played tracks
        let candidates = result.tracks.filter(t => !player.playedHistory.has(getCacheKey(t)));

        // Exhaustion fallback: if all candidates played, clear history for this cycle
        if (candidates.length === 0) {
            Logger.warn(`[AutoplayPrefetch] All ${result.tracks.length} candidates already played — clearing history for this cycle`);
            player.playedHistory.clear();
            candidates = result.tracks;
        }

        // Pick random candidate
        const nextTrack = candidates[Math.floor(Math.random() * candidates.length)];

        // Store pre-fetched track on player
        player.nextAutoplayTrack = nextTrack;

        // Kick off background loudness analysis
        queueLoudnessAnalysis(nextTrack, (cached, avgGain) => {
            // If this track is now playing (edge case: user skipped to it), apply gain immediately
            if (player.queue.current && getCacheKey(player.queue.current) === getCacheKey(nextTrack)) {
                const { applyGainCorrection } = require("./loudness.js");
                applyGainCorrection(player, player.queue.current, client);
            }
        });

        Logger.info(`[AutoplayPrefetch] Pre-fetched: ${nextTrack.title}`);
    } catch (error) {
        Logger.error(`[AutoplayPrefetch] Failed:`, error.message);
        // Don't throw - pre-fetch failure should not affect current playback
    } finally {
        player._prefetchInProgress = false;
    }
}

/**
 * Clear any pre-fetched track (e.g., when autoplay is disabled or user manually queues tracks)
 * @param {Object} player - Rainlink player instance
 */
function clearPrefetch(player) {
    if (player.nextAutoplayTrack) {
        player.nextAutoplayTrack = null;
    }
}

module.exports = {
    preFetchNextAutoplayTrack,
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