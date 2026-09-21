const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

// File path for saving the default EQ profile
const DATA_DIR = path.join(__dirname, "../../../../data");
const EQ_FILE = path.join(DATA_DIR, "eq-preset.json");

// Ensure the data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function getSavedEq() {
    if (fs.existsSync(EQ_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(EQ_FILE, "utf8"));
        } catch (e) {
            console.error("Failed to read eq-preset.json", e);
        }
    }
    return new Array(15).fill(0); // Default to flat EQ if no file exists
}

function saveEq(gains) {
    fs.writeFileSync(EQ_FILE, JSON.stringify(gains, null, 2));
}

function buildEqPayload(client, gains, selectedBand = 0) {
    const freqs = [
        "25 Hz  ", "40 Hz  ", "63 Hz  ", "100 Hz ", "160 Hz ", 
        "250 Hz ", "400 Hz ", "630 Hz ", "1 kHz  ", "1.6 kHz", 
        "2.5 kHz", "4 kHz  ", "6.3 kHz", "10 kHz ", "16 kHz "
    ];

    let content = "**Equalizer Tuner** " + client.config.emojis.ICON_EQ + "\n\n";

    for (let i = 0; i < 15; i++) {
        const e = client.config.emojis; 
        const gain = gains[i];

        // Convert Lavalink gain range (-0.25 to 1.0) into a 0 to 1 percentage
        const percent = (gain + 0.25) / 1.25;
        
        // We can now use 22 pieces because ASCII characters only take 1 byte of data!
        const totalPieces = 22; 
        const fillLevel = percent * totalPieces; 
        const fullCount = Math.floor(fillLevel);
        
        let progressBar = "";
        
        // Build the ASCII bar with ⣿ (full), ⣦ (edge), and ⣀ (empty)
        if (fullCount >= totalPieces) {
            progressBar = "⣿".repeat(totalPieces);
        } else {
            progressBar = "⣿".repeat(fullCount) + "⣦" + "⣀".repeat(totalPieces - fullCount - 1);
        }
        
        const formattedGain = gain.toFixed(2).padStart(5, " ");
        const marker = i === selectedBand ? e.ICON_LEFTSL : ""; 
        
        // The bar is now naturally long enough to push the gain and marker to the right
        content += `  \`${freqs[i]}\`  ${progressBar}   ${formattedGain} ${marker}\n`;
    }

    const container = {
        type: 17, // ComponentType.CONTAINER
        components: [
            { type: 10, content: content } 
        ]
    };

    const selectOptions = freqs.map((f, i) => ({
        label: `${f.trim()} Band`,
        value: i.toString(),
        default: i === selectedBand
    }));

    const row1 = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("eq_select")
            .setOptions(selectOptions)
    ).toJSON();

    // Row 2: All Adjustments combined into one single row
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("eq_minus_05").setLabel("- 0.05").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("eq_minus_01").setLabel("- 0.01").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("eq_zero").setLabel("0").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("eq_plus_01").setLabel("+ 0.01").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("eq_plus_05").setLabel("+ 0.05").setStyle(ButtonStyle.Secondary)
    ).toJSON();

    // Row 3: Action Controls
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("eq_apply").setLabel("Apply").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("eq_save").setLabel("Save Default").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("eq_close").setLabel("Close").setStyle(ButtonStyle.Danger)
    ).toJSON();

    return {
        flags: 32768, // IS_COMPONENTS_V2
        components: [container, row1, row2, row3], 
        allowedMentions: { parse: [] }
    };
}

module.exports = {
    name: "eq",
    description: "Adjust the 15-band Lavalink equalizer",
    
    permissions: {
        bot: ["Speak", "Connect"],
        user: ["Speak", "Connect"],
    },
    settings: {
        voice: true,
        player: false,
        current: false,
    },
    
    run: async (client, interaction) => {
        let currentGains = getSavedEq(); 
        let selectedBand = 0;

        const e = client.config.emojis; 

        const response = await interaction.reply({
            ...buildEqPayload(client, currentGains, selectedBand),
            fetchReply: true
        });

        const collector = response.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id
        });

        collector.on("collect", async (i) => {
            if (i.customId === "eq_select") {
                selectedBand = parseInt(i.values[0]);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_minus_05") {
                currentGains[selectedBand] = Math.max(-0.25, currentGains[selectedBand] - 0.05);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_minus_01") {
                currentGains[selectedBand] = Math.max(-0.25, currentGains[selectedBand] - 0.01);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_zero") { // New logic to reset to 0
                currentGains[selectedBand] = 0;
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_plus_01") {
                currentGains[selectedBand] = Math.min(1.0, currentGains[selectedBand] + 0.01);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_plus_05") {
                currentGains[selectedBand] = Math.min(1.0, currentGains[selectedBand] + 0.05);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
            } else if (i.customId === "eq_apply") {
                saveEq(currentGains);
                
                const currentPlayer = client.rainlink.players.get(interaction.guildId);
                if (currentPlayer) {
                    const bands = currentGains.map((gain, index) => ({ band: index, gain: gain }));
                    currentPlayer.filter.setEqualizer(bands);
                }
                
                await i.update(buildEqPayload(client, currentGains, selectedBand));
                await i.followUp({ content: `${e.ICON_CORRECT} **EQ Applied & Cached!** (It will load automatically on your songs)`, ephemeral: true });
                
            } else if (i.customId === "eq_save") {
                saveEq(currentGains);
                await i.update(buildEqPayload(client, currentGains, selectedBand));
                await i.followUp({ content: `${e.ICON_SAVE} **EQ Saved!** This profile is now your default.`, ephemeral: true });
            } else if (i.customId === "eq_close") {
                collector.stop("closed");
                await i.deferUpdate();
                await i.message.delete().catch(() => {});
            }
        });

        collector.on("end", (collected, reason) => {
            if (reason !== "closed") {
                interaction.deleteReply().catch(() => {});
            }
        });
    }
};