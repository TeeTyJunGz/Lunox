const { EmbedBuilder, MessageFlags } = require("discord.js");
const { disableAutoplay } = require("../../../utils/autoplayPrefetch.js");

module.exports = {
    name: "stop",
    description: "Stop the player",
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
        disableAutoplay(client, player);
        player.stop();

        const embed = new EmbedBuilder().setColor(client.config.embedColor).setDescription(`Skipped the current song.`);

        return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    },
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
