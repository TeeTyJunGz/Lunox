const { EmbedBuilder } = require("discord.js");
const Logger = require("../../../utils/logger");
const { queueLoudnessAnalysis, getCacheKey, applyGainCorrection } = require("../../../utils/loudness.js");
const { preFetchNextAutoplayTrack, findNextAutoplayTrack, clearPrefetch } = require("../../../utils/autoplayPrefetch.js");

module.exports = async (client, player) => {
    if (!player) return;

    if (player.message) player.message.delete().catch((e) => {});

    const channel = await client.channels.cache.get(player.textId);
    const isAutoplayEnabled = client.data.get("autoplay", player.guildId);

    if (isAutoplayEnabled) {
        // If a prefetch is still running, wait for it instead of searching in parallel
        // (parallel searches could pick the same / different duplicate tracks)
        if (player._prefetchPromise) {
            await player._prefetchPromise;
        }

        let nextTrack = player.nextAutoplayTrack;
        player.nextAutoplayTrack = null; // clear after use

        Logger.debug(`[QueueEmpty] Autoplay ON | prefetched=${!!nextTrack} | queueSize=${player.queue.size}`);

        if (!nextTrack) {
            // Fallback: shared finder (never repeats played songs, hops between mixes)
            nextTrack = await findNextAutoplayTrack(player, client);

            if (!nextTrack) {
                client.data.delete("autoplay", player.guildId);
                // Let the voiceStateUpdate handler handle disconnection via its leaveTimeout
                return;
            }
            Logger.debug(`[QueueEmpty] Fresh search picked: ${nextTrack.title.substring(0, 50)}`);
        } else {
            Logger.debug(`[QueueEmpty] Using pre-fetched: ${nextTrack.title.substring(0, 50)}`);
        }

        player.queue.add(nextTrack);

        // Kick off background loudness analysis (fire-and-forget)
        queueLoudnessAnalysis(nextTrack, (cached, avgGain) => {
            if (player.queue.current && getCacheKey(player.queue.current) === getCacheKey(nextTrack)) {
                applyGainCorrection(player, player.queue.current, client);
            }
        });

        // Pre-fetch the NEXT track (N+2) while N+1 plays.
        // N+1 is already reserved in playedHistory, so it can't be picked again.
        Logger.debug(`[QueueEmpty] Triggering pre-fetch for N+2`);
        preFetchNextAutoplayTrack(player, client).catch(() => {});

        if (!player.playing) player.play();
    } else {
        // Clear any pre-fetched track since autoplay is disabled
        clearPrefetch(player);

        try {
            if (player.voiceId) {
                await client.rest.put(`/channels/${player.voiceId}/voice-status`, {
                    body: { status: "" },
                });
            }
        } catch (err) {
            // Ignore errors
        }

        const guildData = client.data.get(`guildData_${player.guildId}`);

        if (guildData && guildData.reconnect.status) return;

        // Set up automatic disconnection after leaveTimeout when idle
        const checkAndDisconnect = async () => {
            const stillNotPlaying = !player.playing && !player.queue.current;
            const stillBotAlone =
                player.voiceId &&
                player.voice?.channel &&
                player.voice.channel.members.filter((m) => !m.user.bot).size === 0;

            if (stillNotPlaying || stillBotAlone) {
                if (player.message) await player.message.delete().catch((e) => {});
                player.destroy().catch((e) => {});
            }
        };

        setTimeout(checkAndDisconnect, client.config.leaveTimeout);
        return;
    }
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */