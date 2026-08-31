const { EmbedBuilder } = require("discord.js");
const Logger = require("../../../utils/logger");
const { shouldSkipOrStop } = require("../../../utils/skipGuard.js");

module.exports = async (client, player, error) => {
    if (!player) return;

    const guild = await client.guilds.cache.get(player.guildId);

    Logger.error(`Track exception in ${guild.name} (${guild.id}): ${error.message}`, error);

    if (player.message) player.message.delete().catch((e) => {});

    const channel = await client.channels.cache.get(player.textId);
    const embed = new EmbedBuilder().setColor(client.config.embedColor);

    const action = shouldSkipOrStop(client, player);

    if (action === 'stop') {
        embed.setDescription(`Track loading failed repeatedly. After ${5} consecutive errors, stopping playback to prevent queue exhaustion.`);
        if (channel) await channel.send({ embeds: [embed] });
        return player.stop();
    }

    // Normal skip behavior
    if (!player.queue.isEmpty) {
        embed.setDescription(`Failed to load track. Skipping to the next song...`);

        if (channel) await channel.send({ embeds: [embed] });
    } else {
        embed.setDescription(`Failed to load track and the queue is empty. Stopping the player...`);

        if (channel) await channel.send({ embeds: [embed] });
    }

    return player.skip();
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */