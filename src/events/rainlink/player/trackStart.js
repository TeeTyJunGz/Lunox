const { GoogleGenerativeAI } = require("@google/generative-ai");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { resetErrorCount } = require("../../../utils/skipGuard.js");
const { getCachedGain, applyGainCorrection, getCacheKey } = require("../../../utils/loudness.js");
const { preFetchNextAutoplayTrack } = require("../../../utils/autoplayPrefetch.js");
const Logger = require("../../../utils/logger.js");

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAIMood(trackTitle, trackAuthor, apiKey) {
    const FALLBACK_MODELS = [
        "gemini-3.5-flash-lite",   // stable, cheap, high throughput
        "gemini-3-flash-preview",  // stable, but slower and more
        "gemini-3.1-flash-lite",   // stable, cheap, high throughput
        "gemini-3.5-flash",        // stable
        "gemini-3.7-flash",		   // stable
        "gemini-3.6-flash",        // stable
    ];
    const MAX_RETRIES = 3;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const promptText = `Song: ${trackTitle}\nArtist: ${trackAuthor}`;
        for (let modelName of FALLBACK_MODELS) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: "You are a music lover reacting to a song playing on Discord.\nYour ONLY task is to return one relatable, emotional sentence about the song's vibe.\nCRITICAL RULES:\n1. NEVER repeat or summarize the song title, artist name, or input text.\n2. If you don't know the song, GUESS the emotion based on the title.\n3. Sound like a real human sharing a vibe.\n4. If the input contains Thai text, use natural conversational Thai, but DO NOT force introductory exclamations or slang. NEVER start with words like โคตรหน่วง, โอ้โห, or ฟีลแบบ.\n5. Jump directly into the core feeling or thought.\n6. Keep the response under 12 words.\n7. NO emojis, NO quotation marks, NO robotic descriptions.\n8. If song is ENG reponse with ENG if other language respond in that language.\n9. If the song is a remix, focus on the original vibe.\n10. NEVER mention the song title or artist in your response.",
                });

                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    try {
                        const result = await model.generateContent(promptText);
                        return result.response.text().trim();
                    } catch (attemptError) {
                        const errorMsg = attemptError.toString();
                        if (errorMsg.includes("503") || errorMsg.includes("Service Unavailable")) {
                            const waitTime = (Math.pow(2, attempt) + Math.random()) * 1000;
                            Logger.warn(`[Gemini API] 503 High Demand on ${modelName} - Retrying attempt ${attempt + 1}, waiting ${(waitTime / 1000).toFixed(1)}s...`);
                            await wait(waitTime);
                        } else if (errorMsg.includes("429") || errorMsg.includes("Rate Limit")) {
                            const waitTime = (5 + Math.random() * 3) * 1000;
                            Logger.warn(`[Gemini API] 429 on ${modelName} - waiting ${(waitTime/1000).toFixed(1)}s...`);
                            await wait(waitTime);
                        } else {
                            Logger.warn(`[Gemini API] Unexpected error on ${modelName}:`, attemptError.message);
                            break; 
                        }
                    }
                }
                Logger.warn(`[Gemini API] ${modelName} exhausted all retries. Downgrading...`);

            } catch (modelError) {
                Logger.warn(`[Gemini API] Failed to initialize or run ${modelName}:`, modelError.message);
            }
        }   

        throw new Error("All fallback models exhausted or unavailable.");

    } catch (finalError) {
        Logger.error("[Gemini API Fatal Error]:", finalError);
        return null;
    }
}

// Notice we now pass "client" as the very first argument so we can access the config!
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

module.exports = async (client, player, track) => {
    if (!player) return;

    resetErrorCount(client, player.guildId);

    if (!player.playedHistory) {
        player.playedHistory = new Set();
    }

    const cacheKey = getCacheKey(track);
    player.playedHistory.add(cacheKey);

    if (player.baseVolume === undefined) {
        player.baseVolume = client.config.defaultVolume; 
    }

    const baseVolume = player.baseVolume;
    const gainMultiplier = getCachedGain(track);

    if (gainMultiplier !== 1.0) {
        const correctedVolume = Math.round(baseVolume * gainMultiplier);
        const clampedVolume = Math.max(client.config.minVolume || 0, Math.min(client.config.maxVolume || 100, correctedVolume));
        if (clampedVolume !== player.volume) {
            player.setVolume(clampedVolume);
        }
    } else {
        if (player.volume !== baseVolume) {
            player.setVolume(baseVolume);
        }
    }

    const isAutoplayEnabled = client.data.get("autoplay", player.guildId);
    if (isAutoplayEnabled && player.queue.size <= 1 && !player.nextAutoplayTrack) {
        preFetchNextAutoplayTrack(player, client).catch(() => {}); 
    }

    const hasAlbum = track.pluginInfo?.albumName || track.albumName;
    
    if (!hasAlbum) track.aiMood = "Loading mood...";
    
    const nplaying = await client.channels.cache.get(player.textId).send(buildV2Payload(client, player, track, 0));
    player.message = nplaying;

    if (!hasAlbum) {
        (async () => {
            const GEMINI_API_KEY = client.config.geminiApiKey;
            Logger.debug(

            "[Gemini API Key]:", 
            GEMINI_API_KEY 
                ? `${GEMINI_API_KEY.slice(0, 6)}...${GEMINI_API_KEY.slice(-4)}` 
                : "Missing"
                
            );
            if (GEMINI_API_KEY) {
                const mood = await fetchAIMood(track.title, track.author, GEMINI_API_KEY);
                
                if (player.queue.current?.uri === track.uri) {
                    Logger.info(`[Gemini API] Mood for "${track.title}": ${mood || "No mood generated"}`);
                    track.aiMood = mood || ""; 
                    await nplaying.edit(buildV2Payload(client, player, track, player.position)).catch(() => {});
                }
            } else {
                track.aiMood = "";
                await nplaying.edit(buildV2Payload(client, player, track, player.position)).catch(() => {});
            }
        })();
    }

    const embed = new EmbedBuilder().setColor(client.config.embedColor);
    const collector = nplaying.createMessageComponentCollector();

    collector.on("collect", async (message) => {
        if (!player) return collector.stop();

        if (!message.member.voice.channel || player.voiceId !== message.member.voice.channelId) {
            return message.deferUpdate();
        }

        if (message.user.id !== track.requester.id) {
            return message.deferUpdate();
        }

        switch (message.customId) {
            case "pause":
                await message.deferUpdate();
                const willPause = !player.paused;
                if (willPause) {
                    player.pause();
                } else {
                    player.resume();
                }
                await nplaying.edit(buildV2Payload(client, player, track, player.position, willPause));
                break;
            case "stop":
                await message.deferUpdate();
                player.stop();
                break;
            case "skip":
                await message.deferUpdate();
                if (player.queue.isEmpty && !client.data.get("autoplay", player.guildId)) {
                    return; 
                }
                player.skip();
                break;
            case "voldown":
                await message.deferUpdate();
                const currentBaseVolume = player.baseVolume ?? client.config.defaultVolume;
                const newBaseVolumeDown = Math.max(client.config.minVolume || 0, currentBaseVolume - 10);
                player.baseVolume = newBaseVolumeDown;

                const currentTrack = player.queue.current;
                if (currentTrack) {
                    applyGainCorrection(player, currentTrack, client);
                } else {
                    player.setVolume(newBaseVolumeDown);
                }
                await nplaying.edit(buildV2Payload(client, player, track, player.position));
                break;
            case "volup":
                await message.deferUpdate();
                const currentBaseVolumeUp = player.baseVolume ?? client.config.defaultVolume;
                const newBaseVolumeUp = Math.min(client.config.maxVolume || 100, currentBaseVolumeUp + 10);
                player.baseVolume = newBaseVolumeUp;

                const currentTrackUp = player.queue.current;
                if (currentTrackUp) {
                    applyGainCorrection(player, currentTrackUp, client);
                } else {
                    player.setVolume(newBaseVolumeUp);
                }
                await nplaying.edit(buildV2Payload(client, player, track, player.position));
                break;
        }
    });
};