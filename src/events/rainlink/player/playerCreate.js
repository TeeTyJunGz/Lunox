const Logger = require("../../../utils/logger");
const fs = require("fs");
const path = require("path");

module.exports = async (client, player) => {
    if (!player) return;

    // Load the saved EQ preset if it exists
    const eqFile = path.join(__dirname, "../../../../data/eq-preset.json");
    if (fs.existsSync(eqFile)) {
        try {
            const savedGains = JSON.parse(fs.readFileSync(eqFile, "utf8"));
            const bands = savedGains.map((gain, index) => ({ band: index, gain: gain }));
            player.filter.setEqualizer(bands);
        } catch (e) {
            console.error("Could not apply default EQ", e);
        }
    }

	// ADD THIS: Initialize the user's volume immediately using your config default (or 50)
    if (player.baseVolume === undefined) {
        player.baseVolume = client.config.defaultVolume;
    }
    
    const guild = await client.guilds.cache.get(player.guildId);
    const guildData = client.data.get(`guildData_${guild.id}`);

    if (guildData.reconnect.status) {
        Logger.debug(`Player reconnected to [${guild.name}] (${guild.id})`);
    } else {
        Logger.debug(`Player created in [${guild.name}] (${guild.id})`);
    }
};

/**
 * Project: Lunox
 * Author: adh319`
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
