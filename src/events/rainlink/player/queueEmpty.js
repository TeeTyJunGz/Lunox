const { EmbedBuilder } = require("discord.js");
const Logger = require("../../../utils/logger");
const { queueLoudnessAnalysis, getCacheKey, applyGainCorrection } = require("../../../utils/loudness.js");
const { preFetchNextAutoplayTrack, clearPrefetch } = require("../../../utils/autoplayPrefetch.js");

module.exports = async (client, player) => {
    if (!player) return;

    if (player.message) player.message.delete().catch((e) => {});

    const channel = await client.channels.cache.get(player.textId);
    const isAutoplayEnabled = client.data.get("autoplay", player.guildId);

    if (isAutoplayEnabled) {
        // Use pre-fetched track if available, otherwise search fresh
        let nextTrack = player.nextAutoplayTrack;
        player.nextAutoplayTrack = null; // clear after use

        Logger.debug(`[QueueEmpty] Autoplay ON | prefetched=${!!nextTrack} | queueSize=${player.queue.size}`);

        if (!nextTrack) {
            // Fallback: search fresh (original behavior)
            const track = player.queue.previous[0];
            const getTrack = `https://music.youtube.com/watch?v=${track.identifier}&list=RD${track.identifier}`;
            const result = await client.rainlink.search(getTrack, { requester: track.requester });

            if (!result || !result.tracks || !result.tracks.length) {
                client.data.delete("autoplay", player.guildId);
                // Instead of destroying immediately, let the voiceStateUpdate handler handle disconnection
                // via its leaveTimeout mechanism when the bot is detected as idle/not playing
                return;
            }

            // Initialize played history if not already (Task 7)
            if (!player.playedHistory) {
                player.playedHistory = new Set();
            }

            // Filter out already-played tracks from autoplay candidates
            let candidates = result.tracks.filter(t => !player.playedHistory.has(getCacheKey(t)));

            // If all candidates are already played, clear history for this one cycle and retry
            if (candidates.length === 0) {
                Logger.warn(`[Autoplay] All ${result.tracks.length} candidates already played in this session — clearing history for this cycle`);
                player.playedHistory.clear();
                candidates = result.tracks;
            }

            nextTrack = candidates[Math.floor(Math.random() * candidates.length)];
            Logger.debug(`[QueueEmpty] Fresh search picked: ${nextTrack.title.substring(0,50)}`);
        } else {
            Logger.debug(`[QueueEmpty] Using pre-fetched: ${nextTrack.title.substring(0,50)}`);
        }

        player.queue.add(nextTrack);

        // Kick off background loudness analysis (fire-and-forget)
        queueLoudnessAnalysis(nextTrack, (cached, avgGain) => {
            if (player.queue.current && getCacheKey(player.queue.current) === getCacheKey(nextTrack)) {
                applyGainCorrection(player, player.queue.current, client);
            }
        });

        // Pre-fetch the NEXT track (N+2) while N+1 plays
        Logger.debug(`[QueueEmpty] Triggering pre-fetch for N+2`);
        preFetchNextAutoplayTrack(player, client).catch(() => {});

        if (!player.playing) player.play();
    } else {
        // Clear any pre-fetched track since autoplay is disabled
        clearPrefetch(player);

        const guildData = client.data.get(`guildData_${player.guildId}`);

        if (guildData && guildData.reconnect.status) return;

        // const embed = new EmbedBuilder()
        //     .setColor(client.config.embedColor)
        //     .setDescription(`The queue is empty. You can disable this by using \`247\` command.`);

        // if (channel) await channel.send({ embeds: [embed] });

        // Set up automatic disconnection after leaveTimeout when idle
        // This handles the case where bot finishes a song and is alone/not playing
        const checkAndDisconnect = async () => {
            // Re-check conditions after timeout
            const stillNotPlaying = !player.playing && !player.queue.current;
            const stillBotAlone = player.voiceId && player.voice?.channel &&
                player.voice.channel.members.filter((m) => !m.user.bot).size === 0;

            if (stillNotPlaying || stillBotAlone) {
                if (player.message) await player.message.delete().catch((e) => {});
                player.destroy().catch((e) => {});
            }
        };

        // Wait for leaveTimeout, then check if we should disconnect
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
