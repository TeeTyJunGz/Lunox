const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { resetErrorCount } = require("../../../utils/skipGuard.js");
const { getCachedGain, applyGainCorrection, getCacheKey } = require("../../../utils/loudness.js");
const { preFetchNextAutoplayTrack } = require("../../../utils/autoplayPrefetch.js");

const BAR_FILLED = "▬";
const BAR_EMPTY = "▬";
const BAR_KNOB = "🔘";

function buildDescription(player, track, position = 0) {
    const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
    const trackTitle = formatString(track.title || "Unknown", 40).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");
    
    const duration = track.duration || 0;
    const trackDuration = track.isStream ? "LIVE" : convertTime(duration);
    
    const barLength = 12;
    let bar = "";
    if (track.isStream) {
        bar = "🔴 LIVE";
    } else {
        const clampedPos = Math.min(position, duration);
        const percent = duration > 0 ? clampedPos / duration : 0;
        const filled = Math.round(percent * barLength);
        const empty = Math.max(0, barLength - filled);
        const progress = BAR_FILLED.repeat(Math.max(0, filled)) + BAR_KNOB + BAR_EMPTY.repeat(empty);
        const current = convertTime(clampedPos);
        
        // Removed bold to match Eara's smaller font
        bar = `${current} ${progress} ${trackDuration}`;
    }

    // Pull album from LavaSrc plugin data if it exists
    const albumName = track.pluginInfo?.albumName || track.albumName || ""; 
    const requesterText = albumName ? `${track.requester} · ${albumName}` : `${track.requester}`;
    const volume = player.baseVolume ?? 100;
    
    // Exact Eara formatting: Link only on title, no bold, no speaker icon
    return `[${trackTitle}](${track.uri}) — ${trackAuthor}\n${requesterText}\n\n${bar}\n${volume}%`;
}

module.exports = async (client, player, track) => {
    if (!player) return;

    resetErrorCount(client, player.guildId);

    if (!player.playedHistory) {
        player.playedHistory = new Set();
    }

    const cacheKey = getCacheKey(track);
    player.playedHistory.add(cacheKey);

    if (player.baseVolume === undefined) {
        player.baseVolume = client.config.defaultVolume; 
    }

    const baseVolume = player.baseVolume;
    const gainMultiplier = getCachedGain(track);

    if (gainMultiplier !== 1.0) {
        const correctedVolume = Math.round(baseVolume * gainMultiplier);
        const clampedVolume = Math.max(client.config.minVolume || 0, Math.min(client.config.maxVolume || 100, correctedVolume));
        if (clampedVolume !== player.volume) {
            player.setVolume(clampedVolume);
        }
    } else {
        if (player.volume !== baseVolume) {
            player.setVolume(baseVolume);
        }
    }

    const isAutoplayEnabled = client.data.get("autoplay", player.guildId);
    if (isAutoplayEnabled && player.queue.size <= 1 && !player.nextAutoplayTrack) {
        preFetchNextAutoplayTrack(player, client).catch(() => {}); 
    }

    const playerEmoji = client.emoji.player;

    const trackMsg = new EmbedBuilder()
        .setColor("#2B2D31") // This hex perfectly blends with Discord's background, hiding the left stripe
        .setDescription(buildDescription(player, track, 0));

    if (track.artworkUrl) {
        trackMsg.setThumbnail(track.artworkUrl);
    }

    // ROW 1: Max 5 buttons allowed per row
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("prev").setEmoji(playerEmoji.previous).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("pause")
            .setEmoji(player.paused ? playerEmoji.resume : playerEmoji.pause)
            .setStyle(player.paused ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(playerEmoji.skip).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("stop").setEmoji(playerEmoji.stop).setStyle(ButtonStyle.Danger)
    );

    // ROW 2: Volume controls
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("voldown").setEmoji(playerEmoji.voldown).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volup").setEmoji(playerEmoji.volup).setStyle(ButtonStyle.Secondary)
    );

    const nplaying = await client.channels.cache.get(player.textId).send({
        embeds: [trackMsg],
        components: [row1, row2],
    });
    player.message = nplaying;

    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const collector = nplaying.createMessageComponentCollector();

    collector.on("collect", async (message) => {
        if (!player) return collector.stop();

        if (!message.member.voice.channel || player.voiceId !== message.member.voice.channelId) {
            embed.setDescription(`You must be in the same voice channel as the bot.`);
            return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        if (message.user.id !== track.requester.id) {
            embed.setDescription(`Only the requester can use this button.`);
            return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        switch (message.customId) {
            case "pause":
                if (!player.paused) {
                    message.deferUpdate();
                    player.pause();
                    row1.components[1].setEmoji(playerEmoji.resume).setStyle(ButtonStyle.Primary);
                } else {
                    message.deferUpdate();
                    player.resume();
                    row1.components[1].setEmoji(playerEmoji.pause).setStyle(ButtonStyle.Secondary);
                }
                await nplaying.edit({ components: [row1, row2] });
                break;
            case "prev":
                if (!player.queue.previous.length) {
                    embed.setDescription(`Previous song not found.`);
                    return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
                }
                message.deferUpdate();
                player.previous();
                break;
            case "skip":
                if (player.queue.isEmpty && !client.data.get("autoplay", player.guildId)) {
                    embed.setDescription(`Queue is empty. Skip not possible.`);
                    return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
                }
                message.deferUpdate();
                player.skip();
                break;
            case "voldown":
                const currentBaseVolume = player.baseVolume ?? client.config.defaultVolume;
                const newBaseVolumeDown = Math.max(client.config.minVolume || 0, currentBaseVolume - 10);
                player.baseVolume = newBaseVolumeDown;

                const currentTrack = player.queue.current;
                if (currentTrack) {
                    applyGainCorrection(player, currentTrack, client);
                } else {
                    player.setVolume(newBaseVolumeDown);
                }

                trackMsg.setDescription(buildDescription(player, track, player.position));
                await nplaying.edit({ embeds: [trackMsg] });

                embed.setDescription(`Volume has been set to \`${newBaseVolumeDown}%\`.`);
                return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
            case "volup":
                const currentBaseVolumeUp = player.baseVolume ?? client.config.defaultVolume;
                const newBaseVolumeUp = Math.min(client.config.maxVolume || 100, currentBaseVolumeUp + 10);
                player.baseVolume = newBaseVolumeUp;

                const currentTrackUp = player.queue.current;
                if (currentTrackUp) {
                    applyGainCorrection(player, currentTrackUp, client);
                } else {
                    player.setVolume(newBaseVolumeUp);
                }

                trackMsg.setDescription(buildDescription(player, track, player.position));
                await nplaying.edit({ embeds: [trackMsg] });

                embed.setDescription(`Volume has been set to \`${newBaseVolumeUp}%\`.`);
                return message.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
            case "stop":
                message.deferUpdate();
                player.stop();
                break;
        }
    });
};
