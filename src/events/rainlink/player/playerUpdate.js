const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");

function buildV2Payload(client, player, track, position = 0, forcePauseState = null) {
    const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
    const safeTitle = (track.title || "Unknown").replace(/\[/g, "(").replace(/\]/g, ")");
    const trackTitle = formatString(safeTitle, 40).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");

    // Pull the emojis directly from your config file
    const e = client.config.emojis;

    const duration = track.duration || 0;
    const trackDuration = track.isStream ? "LIVE" : convertTime(duration);
    
    let bar = "";
    if (track.isStream) {
        bar = "🔴 LIVE";
    } else {
        const clampedPos = Math.min(position, duration);
        const percent = duration > 0 ? clampedPos / duration : 0;
        
        // Treat all 15 segments (1 Start + 13 Middle + 1 End) as a single linear bar
        const totalPieces = 15;
        const fillLevel = percent * totalPieces; // Ranges from 0.0 to 15.0
        
        let progressBar = "";
        
        // 1. Start Cap (Piece 0)
        // Turns white when it reaches 50% of its designated time slice
        progressBar += (fillLevel >= 0.5) ? e.START_WH : e.START_BK;

        // 2. Middle Pieces (Pieces 1 to 13)
        for (let i = 1; i <= 13; i++) {
            if (fillLevel >= i + 0.75) {
                progressBar += e.FULL_WH;
            } else if (fillLevel >= i + 0.25) {
                progressBar += e.HALF_WH;
            } else {
                progressBar += e.FULL_BK;
            }
        }

        // 3. End Cap (Piece 14)
        progressBar += (fillLevel >= 14.5) ? e.END_WH : e.END_BK;
        
        const current = convertTime(clampedPos);
        bar = `${current} ${progressBar} ${trackDuration}`;
    }

    let albumName = track.pluginInfo?.albumName || track.albumName || ""; 
    if (!albumName && track.aiMood) {
        albumName = track.aiMood; 
    }
    
    const requesterText = albumName ? `-# ${track.requester} • ${albumName}` : `-# ${track.requester}`;
    const volume = player.baseVolume ?? 100;

    let sourceIcon = ""; 
    if (track.source === "spotify") sourceIcon = e.ICON_SPOTIFY;
    else if (track.source === "youtube" || track.source === "youtubeMusic") sourceIcon = e.ICON_YOUTUBE;
    else if (track.source === "soundcloud") sourceIcon = e.ICON_SOUNDCLOUD;

    const textBlocks = [
        { type: 10, content: `[${trackTitle}](<${track.uri}>) — ${trackAuthor}  ${sourceIcon}\n${requesterText}` },
        { type: 10, content: `\n\u200b\n${bar}\n-# Volume ${volume}%` }
    ];

    const container = {
        type: 17, 
        components: track.artworkUrl
            ? [
                  {
                      type: 9, 
                      components: textBlocks,
                      accessory: {
                          type: 11, 
                          media: { url: track.artworkUrl }
                      }
                  }
              ]
            : textBlocks
    };

    const isPaused = forcePauseState !== null ? forcePauseState : player.paused;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("pause")
            .setEmoji(isPaused ? e.ICON_RESUME : e.ICON_PAUSE)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("stop").setEmoji(e.ICON_STOP).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(e.ICON_SKIP).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("voldown").setEmoji(e.ICON_VOLDOWN).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volup").setEmoji(e.ICON_VOLUP).setStyle(ButtonStyle.Secondary)
    ).toJSON();

    return {
        flags: 32768, 
        components: [container, row1],
        allowedMentions: { parse: [] } 
    };
}

module.exports = async (client, player, data) => {
    if (!player || !player.message || !player.playing || player.paused) return;

    const track = player.queue.current;
    if (!track || track.isStream) return;

    const position = data?.state?.position ?? data?.position ?? player.position ?? 0;
    const duration = track.duration;
    if (!duration || duration <= 0) return;

    try {
        await player.message.edit(buildV2Payload(client, player, track, position));
    } catch (e) {
        // Message was deleted or missing permissions — silently ignore
    }
};