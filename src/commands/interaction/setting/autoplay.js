const { EmbedBuilder, MessageFlags, ApplicationCommandOptionType } = require("discord.js");
const {
    MODES,
    DEFAULT_MODE,
    FALLBACKS,
    preFetchNextAutoplayTrack,
    setAutoplayMode,
    getAutoplayMode,
    getAutoplayFallback,
    resetAutoplay,
} = require("../../../utils/autoplayPrefetch.js");
const Logger = require("../../../utils/logger");

const MODE_INFO = {
    [MODES.BASED]: "Follows the song you chose. It only uses other songs when yours has nothing new left.",
    [MODES.LAST]: "Follows the song that played last. The music taste can drift over time.",
};

const FALLBACK_INFO = {
    [FALLBACKS.ROTATE]: "When your song runs out, a different history song is used for every pick.",
    [FALLBACKS.STICK]: "When your song runs out, one history song is kept until its fresh songs run out.",
};

module.exports = {
    name: "autoplay",
    description: "Toggle autoplay mode",
    category: "setting",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
    },
    options: [
        {
            name: "mode",
            description: "How autoplay picks songs (default: basedfetch)",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "basedfetch - stay close to the song you chose (default)", value: MODES.BASED },
                { name: "lastfetch - follow the last song that played", value: MODES.LAST },
            ],
        },
        {
            name: "fallback",
            description: "basedfetch only: what to do when your song has no new songs left",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "rotate - use a different history song for every pick (default)", value: FALLBACKS.ROTATE },
                { name: "stick - keep one history song until its fresh songs run out", value: FALLBACKS.STICK },
            ],
        },
    ],
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        // null when the option was not typed
        const requestedMode = interaction.options.getString("mode");
        const requestedFallback = interaction.options.getString("fallback");

        const autoplayOn = client.data.get("autoplay", player.guildId);
        const currentMode = getAutoplayMode(player);
        const currentFallback = getAutoplayFallback(player);

        // "fallback" only exists for basedfetch, so typing it implies basedfetch
        const mode = requestedMode ?? (requestedFallback ? MODES.BASED : autoplayOn ? currentMode : DEFAULT_MODE);
        const fallback = requestedFallback ?? currentFallback;

        // Song autoplay will follow: the last queued song, or the current one if the queue is empty
        const track = player.queue.isEmpty ? player.queue.current : player.queue[player.queue.size - 1];

        // ---- Turn OFF: autoplay is on and nothing different was requested
        if (autoplayOn) {
            const nothingRequested = !requestedMode && !requestedFallback;
            const sameMode = mode === currentMode;
            const sameFallback = mode !== MODES.BASED || fallback === currentFallback;

            if (nothingRequested || (sameMode && sameFallback)) {
                client.data.delete("autoplay", player.guildId);
                resetAutoplay(player);

                embed.setDescription(`Autoplay mode is now \`disabled\``);
                return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
            }
        }

        // ---- Turn ON / SWITCH: needs a YouTube song to follow
        if (!isYoutube(track)) {
            embed.setDescription(
                `${player.queue.isEmpty ? "The current song platform is not supported" : "The last queue platform is not supported"}. Autoplay mode can only be used with YouTube.`,
            );
            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        if (!autoplayOn) client.data.set("autoplay", player.guildId);
        setAutoplayMode(player, mode, track, fallback);

        Logger.debug(`[AutoplayCmd] ${autoplayOn ? "Switched" : "Enabled"} autoplay | mode=${mode} | fallback=${fallback} | base=${track.title}`);

        if (player.queue.current) {
            preFetchNextAutoplayTrack(player, client).catch(() => {});
        }

        const label = mode === MODES.BASED ? `${mode} • ${fallback}` : mode;
        const details = mode === MODES.BASED ? `${MODE_INFO[mode]} ${FALLBACK_INFO[fallback]}` : MODE_INFO[mode];

        embed.setDescription(
            `Autoplay mode is now \`${autoplayOn ? "switched" : "enabled"}\`\n` + `Mode: \`${label}\`. ${details}`,
        );
        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

function isYoutube(track) {
    return track?.source === "youtube";
}

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
