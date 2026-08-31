const { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { find } = require("llyrics");
const gsearch = require("google-search-url");
const Logger = require("../../../utils/logger");

module.exports = {
    name: "lyric",
    description: "Get the lyric of the current song",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const formatText = (text) =>
            text
                .replace(/\(.*?\)/gi, "")
                .replace(/\s/g, "-")
                .replace(/['",]/g, "")
                .replace(/ - Topic$/, "")
                .toLowerCase();

        const track = player.queue.current;
        const trackTitle = formatText(track.title);
        const trackArtist = formatText(track.author);
        const loadingEmbed = new EmbedBuilder().setColor(client.config.embedColor).setDescription(`Please wait...!`);

        // Acknowledge the interaction quickly to avoid "Unknown interaction" when the lyric lookup takes time
        try {
            await interaction.reply({ embeds: [loadingEmbed] });
        } catch (e) {
            Logger.error("[Lyric] Failed to send initial reply:", e.message);
            return;
        }

        let lyricText;
        try {
            lyricText = await lyricFind(trackTitle, trackArtist);
        } catch (e) {
            Logger.error("[Lyric] Lyric search failed:", e.message);
            lyricText = null;
        }

        if (!lyricText) {
            embed.setDescription(`No lyrics found. Please try again later.`);
            await safeEditReply(interaction, { embeds: [embed] });
            return;
        }

        if (lyricText.length <= 4096) {
            embed
                .setAuthor({
                    name: `${client.user.username} Lyrics`,
                    iconURL: client.user.displayAvatarURL(),
                })
                .setThumbnail(track.artworkUrl)
                .setDescription(lyricText);

            await safeEditReply(interaction, { embeds: [embed] });
        } else {
            embed
                .setAuthor({
                    name: `${client.user.username} Lyrics`,
                    iconURL: client.user.displayAvatarURL(),
                })
                .setThumbnail(track.artworkUrl)
                .setDescription(lyricText.substring(0, 4096));

            const lyricUrl = gsearch.craft({ query: `${trackTitle} ${trackArtist} lyrics` }).url;
            const lyricButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setURL(lyricUrl.replace("http:", "https:")).setLabel("Full Lyrics").setStyle(ButtonStyle.Link),
            );

            await safeEditReply(interaction, { embeds: [embed], components: [lyricButton] });
        }
    },
};

async function safeEditReply(interaction, options) {
    try {
        await interaction.editReply(options);
    } catch (e) {
        // Discord API transient errors (500, 502, 503, 504, 429) - log but don't crash
        if (e.status >= 429 && e.status < 600) {
            Logger.warn(`[Lyric] Discord API transient error ${e.status}, reply not sent:`, e.message);
        } else {
            Logger.error("[Lyric] Failed to edit reply:", e.message);
        }
    }
}

async function lyricFind(title, author) {
    try {
        const response = await find({
            song: title,
            artist: author,
            engine: "youtube",
            forceSearch: true,
        });
        const lyricSong = response.lyrics;
        return lyricSong;
    } catch (e) {
        Logger.error("[Lyric] Lyric find error:", e.message);
        return null;
    }
}

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
