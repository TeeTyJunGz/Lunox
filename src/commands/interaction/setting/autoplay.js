const { EmbedBuilder, MessageFlags } = require("discord.js");
const { clearPrefetch, preFetchNextAutoplayTrack } = require("../../../utils/autoplayPrefetch.js");
const Logger = require("../../../utils/logger");

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
    devOnly: false,
    run: async (client, interaction, player) => {
        const embed = new EmbedBuilder().setColor(client.config.embedColor);
        const track = player.queue.isEmpty ? player.queue.current : player.queue[player.queue.size - 1];

        if (!isYoutube(track)) {
            embed.setDescription(
                `${player.queue.isEmpty ? "The current song platform is not supported" : "The last queue platform is not supported"}. Autoplay mode can only be used with YouTube.`,
            );

            return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }

        const autoplay = client.data.get("autoplay", player.guildId);

        if (autoplay) {
            client.data.delete("autoplay", player.guildId);
            clearPrefetch(player);

            embed.setDescription(`Autoplay mode is now \`disabled\``);
        } else {
            client.data.set("autoplay", player.guildId);

            // Trigger pre-fetch immediately so next track is ready with gain correction
            Logger.debug(`[AutoplayCmd] Enabling autoplay | current=${!!player.queue.current} | queueSize=${player.queue.size} | nextPrefetched=${!!player.nextAutoplayTrack}`);
            if (player.queue.current && player.queue.size <= 1 && !player.nextAutoplayTrack) {
                Logger.debug(`[AutoplayCmd] Triggering immediate pre-fetch`);
                preFetchNextAutoplayTrack(player, client).catch(() => {});
            } else {
                Logger.debug(`[AutoplayCmd] Skipping pre-fetch - conditions not met`);
            }

            embed.setDescription(`Autoplay mode is now \`enabled\``);
        }

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
