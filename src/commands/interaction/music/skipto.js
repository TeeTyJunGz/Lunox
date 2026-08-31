const { ApplicationCommandOptionType, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'skipto',
    description: 'Skip to a specific song in the queue',
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
            name: 'position',
            description: 'The position number of the song in the queue to skip to',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1
        }
    ],
    run: async (client, interaction) => {
        const player = client.rainlink.players.get(interaction.guild.id);

        // Basic checks
        if (!player) {
            return interaction.reply({ content: 'There is no music playing right now.', ephemeral: true });
        }
        if (!player.queue.length) {
            return interaction.reply({ content: 'The queue is currently empty.', ephemeral: true });
        }
        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== player.voiceId) {
            return interaction.reply({ content: 'You must be in the same voice channel as me to use this.', ephemeral: true });
        }

        const position = interaction.options.getInteger('position');

        // Ensure the number isn't higher than the actual queue list
        if (position > player.queue.length) {
            return interaction.reply({ content: `Invalid position! The queue only has ${player.queue.length} songs.`, ephemeral: true });
        }

        // Grab the song info before we mutate the queue so we can tell the user what we skipped to
        const targetSong = player.queue[position - 1];

        // If the user chooses a number greater than 1, we delete all songs before it in the array
        if (position > 1) {
            player.queue.splice(0, position - 1);
        }

        // Skip the current playing song (which causes Lavalink to automatically play index 0 of the new queue)
        await player.skip();

        const embed = new EmbedBuilder()
            .setColor(client.color || '#5865F2')
            .setDescription(`⏭️ Skipped ahead to **${targetSong.title}**`);

        return interaction.reply({ embeds: [embed] });
    }
};
