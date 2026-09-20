const { GoogleGenerativeAI } = require("@google/generative-ai");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");
const { resetErrorCount } = require("../../../utils/skipGuard.js");
const { getCachedGain, applyGainCorrection, getCacheKey } = require("../../../utils/loudness.js");
const { preFetchNextAutoplayTrack } = require("../../../utils/autoplayPrefetch.js");

// ==========================================
// 🎨 PROGRESS BAR & BUTTON EMOJI SETTINGS
// ==========================================
const START_WH = "<:Start_WH:1550824319863492679>";
const START_BK = "<:Start_BK:1550824318223785984>";
const HALF_WH  = "<:Half_WH:1550824316633874482>";
const FULL_WH  = "<:Full_WH:1550824314423484416>";
const FULL_BK  = "<:Full_BK:1550824311751704638>";
const END_WH   = "<:End_WH:1550824309579055105>";
const END_BK   = "<:End_BK:1550824299873435658>";

const ICON_PREV    = "<:btn_prev:1550839283911368757>";
const ICON_PLAY    = "<:btn_play:1550839282418196560>";
const ICON_PAUSE   = "<:btn_pause:1550839287765803092>";
const ICON_SKIP    = "<:btn_skip:1550839286042067066>";
const ICON_VOLDOWN = "<:btn_voldown:1550839276613271633>";
const ICON_VOLUP   = "<:btn_volup:1550839279649947658>";
const ICON_STOP    = "<:btn_stop:1550839275346731078>";

// ==========================================
// 🎵 SOURCE ICONS (Upload these to your server!)
// ==========================================
const ICON_SPOTIFY = "<:spotify:1550848197981765723>"; // Replace ID
const ICON_YOUTUBE = "<:youtube:1550843332643655700>"; // Replace ID
const ICON_SOUNDCLOUD = "<:soundcloud:1550843334287953940>"; // Replace ID

// --- GEMINI AI HELPER FUNCTION ---
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAIMood(trackTitle, trackAuthor, apiKey) {
    // Model fallback chain: Start with the best, downgrade if they fail
    const FALLBACK_MODELS = [
        "gemini-3.5-flash",        // stable
        "gemini-3.1-flash-lite",   // stable, cheap, high throughput
        "gemini-3.5-flash-lite",   // stable, cheap, high throughput
        "gemini-3.7-flash",		   // stable
        "gemini-3.6-flash",        // stable
        "gemini-3-flash-preview"   // stable, but slower and more
    ];
    const MAX_RETRIES = 3;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const promptText = `Song: ${trackTitle}\nArtist: ${trackAuthor}`;
        for (let modelName of FALLBACK_MODELS) {
        try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: "You are a music lover reacting to a song playing on Discord.\nYour ONLY task is to return one relatable, emotional sentence about the song's vibe.\nCRITICAL RULES:\n1. NEVER repeat or summarize the song title, artist name, or input text.\n2. If you don't know the song, GUESS the emotion based on the title.\n3. Sound like a real human sharing a vibe.\n4. If the input contains Thai text, use natural conversational Thai, but DO NOT force introductory exclamations or slang. NEVER start with words like โคตรหน่วง, โอ้โห, or ฟีลแบบ.\n5. Jump directly into the core feeling or thought (e.g., สรุปมีแค่เราที่ยังจำได้อยู่คนเดียว).\n6. Keep the response under 12 words.\n7. NO emojis, NO quotation marks, NO robotic descriptions."
            // systemInstruction: "You are a music lover reacting to a song playing on Discord.\nYour ONLY task is to return one relatable, emotional sentence about the song's vibe.\nCRITICAL RULES:\n1. NEVER repeat or summarize the song title, artist name, or input text.\n2. If you don't know the song, GUESS the emotion based on the title.\n3. Sound like a real human sharing a vibe.\n4. If the input contains Thai text, you MUST respond in natural Thai slang.\n5. Keep the response under 12 words.\n6. NO emojis, NO quotation marks, NO robotic descriptions."
        });

        // Implement exponential backoff for this specific model
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const result = await model.generateContent(promptText);
                return result.response.text().trim();
            } catch (attemptError) {
                // Check if the error is a 503 or 429
                const errorMsg = attemptError.toString();
                if (errorMsg.includes("503") || errorMsg.includes("Service Unavailable")) {
                    // Exponential backoff: 2s, 4s, 8s, 16s, 32s + random jitter
                    const waitTime = (Math.pow(2, attempt) + Math.random()) * 1000;
                    console.warn(`[Gemini API] 503 High Demand on ${modelName} - Retrying attempt ${attempt + 1}, waiting ${(waitTime / 1000).toFixed(1)}s...`);
                    await wait(waitTime);
                } else if (errorMsg.includes("429") || errorMsg.includes("Rate Limit")) {
                    const waitTime = (5 + Math.random() * 3) * 1000; // 5-8s, not 60-70s
                    console.warn(`[Gemini API] 429 on ${modelName} - waiting ${(waitTime/1000).toFixed(1)}s...`);
                    await wait(waitTime);
                } else {
                    // If it's a different error (e.g., invalid key), break out of the retry loop and try the next model
                    console.warn(`[Gemini API] Unexpected error on ${modelName}:`, attemptError.message);
                    break; 
                }
            }
        }
                
                // If the loop finishes without returning, this model failed all retries. 
        console.warn(`[Gemini API] ${modelName} exhausted all retries. Downgrading...`);

        } catch (modelError) {
            console.warn(`[Gemini API] Failed to initialize or run ${modelName}:`, modelError.message);
        // Continue to the next model in the fallback chain
            }
        }   

        // If it exits the outer loop, every model in the chain failed.
        throw new Error("All fallback models exhausted or unavailable.");

    } catch (finalError) {
        console.error("[Gemini API Fatal Error]:", finalError);
        return null;
    }
}

function buildV2Payload(player, track, position = 0, forcePauseState = null) {
    const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
    const safeTitle = (track.title || "Unknown").replace(/\[/g, "(").replace(/\]/g, ")");
    const trackTitle = formatString(safeTitle, 40).replace(/ - Topic$/, "");
    const trackAuthor = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");
    
    const duration = track.duration || 0;
    const trackDuration = track.isStream ? "LIVE" : convertTime(duration);
    
    let bar = "";
    if (track.isStream) {
        bar = "🔴 LIVE";
    } else {
        const clampedPos = Math.min(position, duration);
        const percent = duration > 0 ? clampedPos / duration : 0;
        
        const totalMiddle = 13; 
        const filledMiddle = Math.round(percent * totalMiddle);
        
        let progressBar = "";
        progressBar += (percent > 0) ? START_WH : START_BK;

        for (let i = 0; i < totalMiddle; i++) {
            if (i < filledMiddle) {
                progressBar += FULL_WH;
            } else if (i === filledMiddle && percent > 0 && percent < 1) {
                progressBar += HALF_WH;
            } else {
                progressBar += FULL_BK;
            }
        }

        progressBar += (percent === 1) ? END_WH : END_BK;
        
        const current = convertTime(clampedPos);
        bar = `${current} ${progressBar} ${trackDuration}`;
    }

    // --- AI ALBUM LOGIC ---
    let albumName = track.pluginInfo?.albumName || track.albumName || ""; 
    if (!albumName && track.aiMood) {
        albumName = track.aiMood; // Replace blank album with AI response
    }
    
    const requesterText = albumName ? `-# ${track.requester} • ${albumName}` : `-# ${track.requester}`;
    const volume = player.baseVolume ?? 100;

    let sourceIcon = ""; 
    if (track.source === "spotify") sourceIcon = ICON_SPOTIFY;
    else if (track.source === "youtube") sourceIcon = ICON_YOUTUBE;
    else if (track.source === "soundcloud") sourceIcon = ICON_SOUNDCLOUD;

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
            .setEmoji(isPaused ? ICON_PLAY : ICON_PAUSE)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("stop").setEmoji(ICON_STOP).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("skip").setEmoji(ICON_SKIP).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("voldown").setEmoji(ICON_VOLDOWN).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("volup").setEmoji(ICON_VOLUP).setStyle(ButtonStyle.Secondary)
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

    // --- POP UP FIRST, THEN CALL AI ---
    const hasAlbum = track.pluginInfo?.albumName || track.albumName;
    
    // Set a loading state if no album exists
    if (!hasAlbum) track.aiMood = "Loading mood...";
    
    const nplaying = await client.channels.cache.get(player.textId).send(buildV2Payload(player, track, 0));
    player.message = nplaying;

    // Trigger Gemini in the background without making the bot wait
    if (!hasAlbum) {
        (async () => {
            const GEMINI_API_KEY = client.config.geminiApiKey;
            
			console.log(
              "[Gemini API Key]:", GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0, 6)}...${GEMINI_API_KEY.slice(-4)}` : "Missing"
              );
                          
            if (GEMINI_API_KEY) {
                const mood = await fetchAIMood(track.title, track.author, GEMINI_API_KEY);
                
                // Only update if the track hasn't skipped while waiting for AI
                if (player.queue.current?.uri === track.uri) {
                    track.aiMood = mood || ""; // Fallback to blank if it fails
                    await nplaying.edit(buildV2Payload(player, track, player.position)).catch(() => {});
                }
            } else {
                track.aiMood = "";
                await nplaying.edit(buildV2Payload(player, track, player.position)).catch(() => {});
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
                await nplaying.edit(buildV2Payload(player, track, player.position, willPause));
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
                await nplaying.edit(buildV2Payload(player, track, player.position));
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
                await nplaying.edit(buildV2Payload(player, track, player.position));
                break;
        }
    });
};
