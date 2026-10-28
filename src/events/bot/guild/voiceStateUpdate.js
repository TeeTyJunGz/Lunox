const { PermissionsBitField, EmbedBuilder } = require("discord.js");
const { buildStatusText, setVoiceStatus } = require("../../../utils/voiceStatus.js");

module.exports = async (client, oldState, newState) => {
    if (newState.channelId && newState.channel.type == 13 && newState.guild.members.me.voice.suppress) {
        if (
            newState.guild.members.me.permissions.has(PermissionsBitField.Flags.Speak) ||
            newState.channel.permissionsFor(newState.guild.members.me).has(PermissionsBitField.Flags.Speak)
        ) {
            newState.guild.members.me.voice.setSuppressed(false);
        }
    }

    if (
        newState.id === client.user.id &&
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId
    ) {
        await handleBotMoved(client, oldState, newState);
    }

    const newStatePlayer = client.rainlink.players.get(newState.guildId);

    if (newStatePlayer && newState.channelId == null && newState.member?.user.id === client.user?.id) {
        newStatePlayer.state !== 2 ? newStatePlayer.destroy() : true;
    }

    const guildData = client.data.get(`guildData_${newState.guildId || oldState.guildId}`);

    if (guildData && guildData.reconnect.status) return;

    const oldStatePlayer = client.rainlink.players.get(oldState.guildId || newState.guildId);

    if (!oldStatePlayer) return;

    const isBotAlone =
        oldState.guild.members.me.voice?.channel && oldState.guild.members.me.voice.channel.members.filter((m) => !m.user.bot).size === 0;

    const isNotPlaying = !oldStatePlayer.playing && !oldStatePlayer.queue.current;

//     if (oldStatePlayer.voiceId || oldState.guild.members.me.voice.channelId === oldState.channelId) {
//         if (isBotAlone || isNotPlaying) {
//             await delay(client.config.leaveTimeout);

//             const vcMembers = oldState.guild.members.me.voice.channel?.members.size;
//             const leaveEmbed = await client.channels.cache.get(oldStatePlayer.textId);
//             const stillBotAlone = oldState.guild.members.me.voice.channel?.members.filter((m) => !m.user.bot).size === 0;
//             const stillNotPlaying = !oldStatePlayer.playing && !oldStatePlayer.queue.current;

//             if ((stillBotAlone || stillNotPlaying) && (!vcMembers || vcMembers === 1 || vcMembers > 1)) {
//                 if (oldStatePlayer.message) await oldStatePlayer.message.delete().catch((e) => {});

//                 oldStatePlayer.destroy().catch((e) => {});

//                 const timeoutEmbed = new EmbedBuilder()
//                     .setColor(client.config.embedColor)
//                     .setDescription(
//                         `Disconnecting from the voice channel due to inactivity. You can disable this by using \`247\` command.`,
//                     );

//                 return leaveEmbed.send({ embeds: [timeoutEmbed] }).then((msg) => {
//                     if (!msg) return;

//                     setTimeout(() => {
//                         msg.delete().catch(() => {});
//                     }, 10000);
//                 });
//             }
//         }
//     }
// };

    if (oldStatePlayer.voiceId || oldState.guild.members.me.voice.channelId === oldState.channelId) {
        if (isBotAlone || isNotPlaying) {
            await delay(client.config.leaveTimeout);

            const vcMembers = oldState.guild.members.me.voice.channel?.members.size;
            const leaveEmbed = await client.channels.cache.get(oldStatePlayer.textId);
            const stillBotAlone = oldState.guild.members.me.voice.channel?.members.filter((m) => !m.user.bot).size === 0;
            const stillNotPlaying = !oldStatePlayer.playing && !oldStatePlayer.queue.current;

            if ((stillBotAlone || stillNotPlaying) && (!vcMembers || vcMembers === 1 || vcMembers > 1)) {
                if (oldStatePlayer.message) await oldStatePlayer.message.delete().catch((e) => {});

                oldStatePlayer.destroy().catch((e) => {});

                const timeoutEmbed = new EmbedBuilder()
                    .setColor(client.config.embedColor)
                    .setDescription(
                        `Disconnecting from the voice channel due to inactivity. You can disable this by using \`247\` command.`,
                    );

                return leaveEmbed.send({ embeds: [timeoutEmbed] }).then((msg) => {
                    if (!msg) return;

                    setTimeout(() => {
                        msg.delete().catch(() => {});
                    }, 10000);
                });
            }
        }
    }
};

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleBotMoved(client, oldState, newState) {
    const guildId = newState.guild.id;
    const player = client.rainlink.players.get(guildId);
    if (!player) return;

    const oldId = oldState.channelId;
    const newId = newState.channelId;

    // 1. Point the player at the new channel
    player.voiceId = newId;

    // Keep Rainlink's internal voice connection in sync too (if present)
    const voice = client.rainlink.voices?.get(guildId);
    if (voice && "channelId" in voice) voice.channelId = newId;

    // 2. Keep 24/7 pointing at the new channel
    const guildData = client.data.get(`guildData_${guildId}`);
    if (guildData?.reconnect?.status) guildData.reconnect.voice = newId;

    // 3. Move the VC status: clear old channel, set new channel
    await setVoiceStatus(client, oldId, "");
    if (player.queue.current) {
        await setVoiceStatus(client, newId, buildStatusText(client, player.queue.current));
    }
}

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
