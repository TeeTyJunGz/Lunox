const { EmbedBuilder } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");

const BAR_FILLED = "▬";
const BAR_EMPTY = "▬";
const BAR_KNOB = "🔘";

function buildDescription(player, track, position = 0) {
    const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
    const trackTitle = formatString(track.title || "Unknown", 40).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");
    
    const duration = track.duration || 0;
    const trackDuration = track.isStream ? "LIVE" : convertTime(duration);
    
    const barLength = 12;
    let bar = "";
    if (track.isStream) {
        bar = "🔴 LIVE";
    } else {
        const clampedPos = Math.min(position, duration);
        const percent = duration > 0 ? clampedPos / duration : 0;
        const filled = Math.round(percent * barLength);
        const empty = Math.max(0, barLength - filled);
        const progress = BAR_FILLED.repeat(Math.max(0, filled)) + BAR_KNOB + BAR_EMPTY.repeat(empty);
        const current = convertTime(clampedPos);
        bar = `${current} ${progress} ${trackDuration}`; // Removed bold
    }

    const albumName = track.pluginInfo?.albumName || track.albumName || ""; 
    const requesterText = albumName ? `${track.requester} · ${albumName}` : `${track.requester}`;
    const volume = player.baseVolume ?? 100;
    
    return `[${trackTitle}](${track.uri}) — ${trackAuthor}\n${requesterText}\n\n${bar}\n${volume}%`;
}

module.exports = async (client, player, data) => {
    if (!player || !player.message || !player.playing || player.paused) return;

    const track = player.queue.current;
    if (!track || track.isStream) return;

    const position = data?.state?.position ?? data?.position ?? player.position ?? 0;
    const duration = track.duration;
    if (!duration || duration <= 0) return;

    try {
        const oldEmbed = player.message.embeds[0];
        if (!oldEmbed) return;

        const updatedEmbed = EmbedBuilder.from(oldEmbed);
        updatedEmbed.setDescription(buildDescription(player, track, position));

        await player.message.edit({ embeds: [updatedEmbed] });
    } catch (e) {
        // Message was deleted or missing permissions — silently ignore
    }
};
