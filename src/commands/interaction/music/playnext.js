const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');
const { queueLoudnessAnalysis, getCacheKey, applyGainCorrection } = require('../../../utils/loudness.js');

module.exports = {
    name: 'playnext',
    description: 'Add a single song to the front of the queue to play next',
    category: 'Music',
    permissions: {
        bot: [],
        user: []
    },
    settings: {
        inVc: true,
        sameVc: true,
        player: true,
        current: false,
        owner: false,
        voice: true
    },
    options: [
        {
            name: 'song',
            description: 'The name or URL of the song you want to play next',
            type: ApplicationCommandOptionType.String,
            required: true,
            autocomplete: true,
        }
    ],
    run: async (client, interaction) => {
        await interaction.deferReply();

        const query = interaction.options.getString('song');
        const player = client.rainlink.players.get(interaction.guild.id);

        const result = await client.rainlink.search(query, { requester: interaction.user });

        if (!result.tracks.length) {
            return interaction.editReply({ content: '❌ No results found for that query.' });
        }

        if (result.type === 'PLAYLIST') {
            return interaction.editReply({ content: '❌ Playlists are not allowed for `/playnext`. Please provide a single track.' });
        }

        const track = result.tracks[0];

        const currentSize = player.queue.size + (player.playing ? 1 : 0);
        if (currentSize >= client.config.maxQueueSize) {
            return interaction.editReply({ content: `❌ Queue is full (max ${client.config.maxQueueSize} tracks). Cannot add this track.` });
        }

        player.queue.unshift(track);
        // Kick off background loudness analysis (fire-and-forget)
        // Pass callback to apply gain if this track is currently playing (playing now or will play next)
        queueLoudnessAnalysis(track, (cached, avgGain) => {
            if (player.queue.current && getCacheKey(player.queue.current) === getCacheKey(track)) {
                applyGainCorrection(player, player.queue.current, client);
            }
        });

        const embed = new EmbedBuilder()
            .setColor(client.color || '#5865F2')
            .setDescription(`🎵 **[${track.title}](${track.uri})** has been added to the front of the queue and will play next!`);

        return interaction.editReply({ embeds: [embed] });
    }
};

// Simple in-memory cache for recent autocomplete queries to reduce latency
const __autocompleteCache = new Map();

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

// Autocomplete handler for `/playnext` — same pattern as `/play`
module.exports.autocomplete = async (client, interaction) => {
    const handlerStart = Date.now();
    try {
        const focused = interaction.options.getFocused();
        if (!focused || focused.length === 0) {
            try {
                client.utils?.logger?.debug?.(`[Autocomplete] empty focused for /playnext`);
            } catch (e) {}
            return interaction.respond([]);
        }

        const cacheKey = `playnext:autocomplete:${focused}`;
        const cached = __autocompleteCache.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached.ts < 3000) {
            try {
                client.utils?.logger?.debug?.(`[Autocomplete] cache hit for query="${focused}" (${now - cached.ts}ms old)`);
            } catch (e) {}
            return interaction.respond(cached.choices.slice(0, 15));
        }

        const perSource = 5;
        const sources = [
            { id: "sp", name: "Spotify", icon: "🟢" },
            { id: "yt", name: "YouTube", icon: "🔴" },
        ];

        const perSourceTimeout = 2500;

        const searchPromises = sources.map((s) => {
            const srcStart = Date.now();
            return withTimeout(
                client.rainlink.search(focused, { requester: interaction.user, sourceID: s.id }).catch(() => null),
                perSourceTimeout,
            ).then((res) => {
                const elapsed = Date.now() - srcStart;
                try {
                    if (!res || !res.tracks || !Array.isArray(res.tracks)) {
                        client.utils?.logger?.debug?.(`[Autocomplete] ${s.name} (${s.id}) settled in ${elapsed}ms — no data/timeout for query="${focused}"`);
                    } else {
                        client.utils?.logger?.debug?.(`[Autocomplete] ${s.name} (${s.id}) settled in ${elapsed}ms — ${res.tracks.length} hits for query="${focused}"`);
                    }
                } catch (e) {}

                return { source: s.name, id: s.id, icon: s.icon, data: res, elapsed };
            }).catch((err) => {
                const elapsed = Date.now() - srcStart;
                try { client.utils?.logger?.debug?.(`[Autocomplete] ${s.name} (${s.id}) rejected in ${elapsed}ms for query="${focused}": ${String(err)}`); } catch(e){}
                return { source: s.name, id: s.id, icon: s.icon, data: null, elapsed };
            });
        });

        const results = await Promise.all(searchPromises);

        const choices = [];

        for (const result of results) {
            if (!result || !result.data || !Array.isArray(result.data.tracks)) continue;
            const tracks = result.data.tracks.slice(0, perSource);

            for (const t of tracks) {
                const title = (t.title || t.info?.title || "Unknown").toString();
                const author = (t.author || t.info?.author || "Unknown").toString();
                const srcIcon = result.icon ? `${result.icon} ` : "";
                let label = `${srcIcon}${title} — ${author}`;
                if (label.length > 100) label = label.substring(0, 97) + "...";

                const value = (t.uri || t.info?.uri || `${title} - ${author}`).toString();

                choices.push({ name: label, value });

                if (choices.length >= 25) break;
            }

            if (choices.length >= 25) break;
        }

        const finalChoices = choices.slice(0, perSource * sources.length);

        const totalElapsed = Date.now() - handlerStart;
        try {
            client.utils?.logger?.debug?.(`[Autocomplete] responding with ${finalChoices.length} choices in ${totalElapsed}ms for query="${focused}"`);
        } catch (e) {}

        __autocompleteCache.set(cacheKey, { ts: now, choices: finalChoices });

        return interaction.respond(finalChoices);
    } catch (error) {
        try {
            client.utils?.logger?.error?.("Autocomplete error:", error);
        } catch (e) {}

        try {
            return interaction.respond([]);
        } catch (e) {}
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