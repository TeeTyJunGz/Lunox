const { EmbedBuilder, MessageFlags, ApplicationCommandOptionType } = require("discord.js");
const {
    MODES,
    DEFAULT_MODE,
    preFetchNextAutoplayTrack,
    setAutoplayMode,
    getAutoplayMode,
    resetAutoplay,
} = require("../../../utils/autoplayPrefetch.js");
const Logger = require("../../../utils/logger");

const MODE_INFO = {
    [MODES.BASED]: "Follows the song you chose. It only drifts to related songs when nothing new is left.",
    [MODES.LAST]: "Follows the song that played last. The music taste can drift over time.",
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
    ],
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);

        // null when the user typed just /autoplay
        const requestedMode = interaction.options.getString("mode");
        const autoplayOn = client.data.get("autoplay", player.guildId);
        const currentMode = getAutoplayMode(player);

        // Song autoplay will follow: the last queued song, or the current one if the queue is empty
        const track = player.queue.isEmpty ? player.queue.current : player.queue[player.queue.size - 1];

        // ---- Turn OFF: autoplay is on and user did not ask for a different mode
        if (autoplayOn && (!requestedMode || requestedMode === currentMode)) {
            client.data.delete("autoplay", player.guildId);
            resetAutoplay(player);

            embed.setDescription(`Autoplay mode is now \`disabled\``);
            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        // ---- Turn ON / SWITCH MODE: needs a YouTube song to follow
        if (!isYoutube(track)) {
            embed.setDescription(
                `${player.queue.isEmpty ? "The current song platform is not supported" : "The last queue platform is not supported"}. Autoplay mode can only be used with YouTube.`,
            );
            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        const mode = requestedMode || DEFAULT_MODE;

        if (!autoplayOn) client.data.set("autoplay", player.guildId);
        setAutoplayMode(player, mode, track);

        Logger.debug(`[AutoplayCmd] ${autoplayOn ? "Switched" : "Enabled"} autoplay | mode=${mode} | base=${track.title}`);

        if (player.queue.current) {
            preFetchNextAutoplayTrack(player, client).catch(() => {});
        }

        embed.setDescription(
            `Autoplay mode is now \`${autoplayOn ? `switched to ${mode}` : "enabled"}\`\n` +
                `Mode: \`${mode}\`. ${MODE_INFO[mode]}`,
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