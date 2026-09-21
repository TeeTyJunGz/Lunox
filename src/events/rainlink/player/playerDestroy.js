const Logger = require("../../../utils/logger");

module.exports = async (client, player) => {
    if (!player) return;

    const guild = await client.guilds.cache.get(player.guildId);

    Logger.debug(`Player destroyed from [${guild.name}] (${guild.id})`);

	try {
        if (player.voiceId) {
            await client.rest.put(`/channels/${player.voiceId}/voice-status`, {
                body: { status: "" } // Sending an empty string clears it
            });
        }
    } catch (err) {
        // Ignore errors
    }
    
    if (player.message) player.message.delete().catch((e) => {});

    const guildData = client.data.get(`guildData_${guild.id}`);

    if (guildData && guildData.reconnect.status) {
        const voice = await client.channels.cache.get(guildData.reconnect.voice);
        const text = await client.channels.cache.get(guildData.reconnect.text);

        if (!voice || !text) {
            guildData.reconnect = { status: false, text: null, voice: null };

            await guildData.save();

            return;
        }

        return await client.rainlink.create({
            guildId: guild.id,
            voiceId: voice.id,
            textId: text.id,
            shardId: guild.shardId,
            volume: client.config.defaultVolume,
            deaf: true,
        });
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
