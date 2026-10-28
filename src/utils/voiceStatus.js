const Logger = require("./logger.js");

const formatString = (str, max) => (str.length > max ? str.substring(0, max - 3) + "..." : str);

function buildStatusText(client, track) {
    if (!track) return "";

    const statusEmoji = client.emoji?.gif?.gifAudioLine || "🎵";
    const safeTitle = (track.title || "Unknown").replace(/\[/g, "(").replace(/\]/g, ")");
    const trackTitle = formatString(safeTitle, 40).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");

    return `${statusEmoji}  ${trackTitle} — ${trackAuthor}`.substring(0, 500);
}

async function setVoiceStatus(client, channelId, status) {
    if (!channelId) return;
    try {
        await client.rest.put(`/channels/${channelId}/voice-status`, {
            body: { status: status || "" },
        });
    } catch (err) {
        Logger.error(`[VC Status Error] (${channelId}): ${err.message}`);
    }
}

module.exports = { buildStatusText, setVoiceStatus };