const { EmbedBuilder, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = {
    name: "filter",
    description: "Set the filter",
    category: "music",
    options: [
        {
            name: "mode",
            description: "Choose a filter",
            type: 3,
            required: true,
            choices: [
                { name: "8d", value: "eightD" },
                { name: "bass", value: "bass" },
                { name: "chipmunk", value: "chimpunk" },
                { name: "clear", value: "clear" },
                { name: "earrape", value: "earrape" },
                { name: "electronic", value: "electronic" },
                { name: "karaoke", value: "karaoke" },
                { name: "nightcore", value: "nightcore" },
                { name: "pitch", value: "pitch" },
                { name: "slow", value: "slow" },
                { name: "soft", value: "soft" },
                { name: "tremolo", value: "tremolo" },
                { name: "treblebass", value: "treblebass" },
                { name: "vaporwave", value: "vaporwave" },
                { name: "vibrato", value: "vibrato" },
                // For additional options, check the official RainlinkFilter documentation here: https://docs-rainlinkjs.vercel.app/classes/RainlinkFilter.html#set
            ],
        },
    ],
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
        const mode = interaction.options.getString("mode");
        const currentVolume = player.volume;

        player.filter.set(mode);

        if (mode === "clear") {
            embed.setDescription(`Filter has been cleared. (Default EQ restored)`);
            
            // Load and apply the saved EQ preset directly (this clears other filters and restores your EQ)
            const EQ_FILE = path.join(__dirname, "../../../../data/eq-preset.json");
            if (fs.existsSync(EQ_FILE)) {
                try {
                    const savedGains = JSON.parse(fs.readFileSync(EQ_FILE, "utf8"));
                    const bands = savedGains.map((gain, index) => ({ band: index, gain: gain }));
                    player.filter.setEqualizer(bands);
                } catch (e) {
                    console.error("Could not reapply EQ after clearing filters", e);
                }
            } else {
                // Fallback if no preset file exists
                player.filter.clear();
            }
        } else {
            // For any other filter (nightcore, bass, etc.), apply it normally
            player.filter.set(mode);
            embed.setDescription(`Filter has been set to: \`${mode}\``);
        }

        player.setVolume(currentVolume);

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
