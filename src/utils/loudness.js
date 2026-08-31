/**
 * Loudness Normalization Utility
 *
 * Performs background loudness analysis using ffmpeg's loudnorm filter
 * and caches results for per-track gain correction.
 *
 * Features:
 * - Persistent JSON file storage (survives restarts)
 * - Stores up to 5 LUFS measurements per track, averages after 5
 * - Concurrency-limited background queue (2 at a time)
 * - Fire-and-forget analysis when tracks added to queue
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const Logger = require("./logger");

// ============================================================
// CONFIGURATION
// ============================================================

const CACHE_FILE = path.join(__dirname, "../../loudness-cache.json");
const COOKIES_FILE = path.join(__dirname, "../../youtube-cookies.txt"); // Optional: export cookies from browser
const TARGET_LUFS = -14;
const MIN_GAIN = 0.3;
const MAX_GAIN = 2.5;
const SPOTIFY_FALLBACK_GAIN = 0.5;
const YOUTUBE_FALLBACK_GAIN = 0.7;
const MAX_SAMPLES_PER_TRACK = 5;
const MAX_CONCURRENT_ANALYSIS = 2;
const SAVE_INTERVAL_MS = 30000;

// ============================================================
// IN-MEMORY STATE
// ============================================================

// Main cache: key -> { samples: [{ measuredLUFS, gainMultiplier, analyzedAt }], avgGain: number, sampleCount: number }
const loudnessCache = new Map();

// Background analysis queue with concurrency control
const analysisQueue = [];
let activeAnalysisCount = 0;
let saveTimer = null;
let isShuttingDown = false;
let cacheDirty = false;

// ============================================================
// PERSISTENCE: LOAD/SAVE
// ============================================================

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
            for (const [key, value] of Object.entries(data)) {
                loudnessCache.set(key, value);
            }
            Logger.info(`[Loudness] Loaded ${loudnessCache.size} cached tracks from ${CACHE_FILE}`);
        }
    } catch (e) {
        Logger.warn(`[Loudness] Failed to load cache file: ${e.message}`);
    }
}

function saveCache() {
    if (isShuttingDown || loudnessCache.size === 0 || !cacheDirty) return;
    try {
        const data = Object.fromEntries(loudnessCache.entries());
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
        cacheDirty = false;
        Logger.debug(`[Loudness] Saved ${loudnessCache.size} tracks to cache file`);
    } catch (e) {
        Logger.error(`[Loudness] Failed to save cache file: ${e.message}`);
    }
}

function startAutoSave() {
    if (saveTimer) return;
    saveTimer = setInterval(saveCache, SAVE_INTERVAL_MS);
    saveTimer.unref(); // Don't prevent process exit
}

function stopAutoSave() {
    if (saveTimer) {
        clearInterval(saveTimer);
        saveTimer = null;
    }
    saveCache(); // Final save
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function lufsToGainMultiplier(measuredLUFS) {
    const gain = Math.pow(10, (TARGET_LUFS - measuredLUFS) / 20);

    if (gain < MIN_GAIN) {
        Logger.warn(`[Loudness] Gain ${gain.toFixed(3)} below minimum ${MIN_GAIN}, clamping (measured: ${measuredLUFS.toFixed(1)} LUFS)`);
        return MIN_GAIN;
    }
    if (gain > MAX_GAIN) {
        Logger.warn(`[Loudness] Gain ${gain.toFixed(3)} above maximum ${MAX_GAIN}, clamping (measured: ${measuredLUFS.toFixed(1)} LUFS)`);
        return MAX_GAIN;
    }
    return gain;
}

function getCacheKey(track) {
    if (track.source === "spotify" || track.source === "applemusic" || track.source === "deezer") {
        if (track.pluginInfo?.spotify?.uri) {
            return `spotify:${track.pluginInfo.spotify.uri}`;
        }
        if (track.isrc) {
            return `spotify:isrc:${track.isrc}`;
        }
        return `spotify:meta:${track.title}|${track.author}`;
    }

    if (track.uri) {
        const ytMatch = track.uri.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) {
            return `youtube:${ytMatch[1]}`;
        }
        return `youtube:${track.uri}`;
    }

    return `unknown:${track.title}|${track.author}`;
}

function spawnYtDlpAudioStream(videoUrl) {
    const isSearch = videoUrl.startsWith("ytsearch:") || videoUrl.startsWith("ymsearch:");
    // Try format 251 (opus 129k) first, fall back to 140 (m4a 130k), then 249 (opus 46k), then bestaudio
    // This matches the formats that android_vr client typically provides
    const args = [
        "-f", "251/140/249/bestaudio",  // Prefer opus 251, fallback chain for compatibility
        "--no-playlist", "--no-warnings",
        // Use web_embedded_player client which provides a wider range of formats and works reliably with pipe
        "--extractor-args", "youtube:player_client=web_embedded_player",
        // Improve reliability against YouTube bot detection
        "--extractor-retries", "3",
        "--sleep-interval", "1",
        "--max-sleep-interval", "3",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-o", "-",  // Output to stdout
        "--no-simulate", // Actually download (not just simulate)
    ];

    // Add cookies if file exists (helps with YouTube bot detection)
    if (fs.existsSync(COOKIES_FILE)) {
        args.push("--cookies", COOKIES_FILE);
    }

    if (isSearch) args.push("--max-downloads", "1");
    args.push(videoUrl);

    const ytDlp = spawn("yt-dlp", args);

    // Suppress yt-dlp stderr (progress/metadata) from polluting stdout audio stream
    // but still capture it for error reporting
    ytDlp.stderr.on("data", () => {}); // Discard stderr by default

    return ytDlp;
}

function analyzeLoudnessFromStream(ytDlpProcess) {
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
            "-hide_banner", "-loglevel", "info",
            "-i", "pipe:0",  // Read from stdin
            "-af", `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
            "-f", "null", "-"
        ]);
        let stdout = "", stderr = "", ytDlpStderr = "";

        // Pipe yt-dlp stdout -> ffmpeg stdin
        ytDlpProcess.stdout.pipe(ffmpeg.stdin);

        // Capture yt-dlp stderr for debugging
        ytDlpProcess.stderr.on("data", (data) => { ytDlpStderr += data.toString(); });

        // Handle yt-dlp errors
        ytDlpProcess.on("error", (err) => {
            // If yt-dlp errors, kill ffmpeg and reject
            ffmpeg.kill("SIGTERM");
            reject(err);
        });

        // Handle yt-dlp close (premature)
        ytDlpProcess.on("close", (code) => {
            if (code !== 0) {
                // Don't reject here - let ffmpeg's close handler handle it
                // yt-dlp might exit with non-zero but still have output
            }
        });

        ffmpeg.stdout.on("data", (data) => { stdout += data.toString(); });
        ffmpeg.stderr.on("data", (data) => { stderr += data.toString(); });
        ffmpeg.on("close", (code) => {
            if (code === 0) {
                try {
                    const jsonMatch = stderr.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        const parsed = JSON.parse(jsonMatch[0]);
                        const input_i = parsed.input_i;
                        if (typeof input_i === "number" && isFinite(input_i)) {
                            resolve(input_i);
                        } else if (typeof input_i === "string" && !isNaN(parseFloat(input_i))) {
                            resolve(parseFloat(input_i));
                        } else {
                            reject(new Error("Invalid input_i in loudnorm output"));
                        }
                    } else {
                        reject(new Error("No JSON output from loudnorm"));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse loudnorm output: ${e.message}`));
                }
            } else {
                reject(new Error(`ffmpeg failed (code ${code}): ${stderr}${ytDlpStderr ? " | yt-dlp: " + ytDlpStderr : ""}`));
            }
        });
        ffmpeg.on("error", (err) => {
            ytDlpProcess.kill("SIGTERM");
            reject(err);
        });
    });
}

// ============================================================
// BACKGROUND QUEUE WITH CONCURRENCY CONTROL
// ============================================================

function processQueue() {
    while (activeAnalysisCount < MAX_CONCURRENT_ANALYSIS && analysisQueue.length > 0) {
        const { track, resolve, reject, onComplete } = analysisQueue.shift();
        activeAnalysisCount++;
        analyzeTrackLoudnessInternal(track, onComplete)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                activeAnalysisCount--;
                processQueue(); // Process next in queue
            });
    }
}

function queueLoudnessAnalysis(track, onComplete) {
    return new Promise((resolve, reject) => {
        analysisQueue.push({ track, resolve, reject, onComplete });
        processQueue();
    });
}

// ============================================================
// CORE ANALYSIS WITH AVERAGING
// ============================================================

async function analyzeTrackLoudnessInternal(track, onComplete) {
    const cacheKey = getCacheKey(track);

    // Check if we already have 5+ samples with an average
    const existing = loudnessCache.get(cacheKey);
    if (existing && existing.sampleCount >= MAX_SAMPLES_PER_TRACK && existing.avgGain) {
        Logger.debug(`[Loudness] Cache hit (averaged) for ${cacheKey}: gain=${existing.avgGain.toFixed(3)} (from ${existing.sampleCount} samples)`);
        if (onComplete) onComplete(existing, existing.avgGain);
        return existing.avgGain;
    }

    // If we have some samples but not 5 yet, check if we should use the average anyway
    // (for tracks that haven't reached 5 plays but we want to use current data)
    if (existing && existing.samples && existing.samples.length > 0) {
        const currentAvg = existing.samples.reduce((sum, s) => sum + s.gainMultiplier, 0) / existing.samples.length;
        Logger.debug(`[Loudness] Cache hit (partial) for ${cacheKey}: gain=${currentAvg.toFixed(3)} (from ${existing.samples.length} samples)`);
        // Still proceed to analyze to collect more samples
    }

    Logger.debug(`[Loudness] Starting analysis for ${cacheKey} (source: ${track.source})`);

    try {
        let measuredLUFS;

        if (track.source === "spotify" || track.source === "applemusic" || track.source === "deezer") {
            let searchAttempts = [];
            if (track.isrc) searchAttempts.push(`ytsearch:${track.isrc}`);
            searchAttempts.push(`ytsearch:${track.title} ${track.author}`);

            let lastError = null;
            for (const attemptUrl of searchAttempts) {
                try {
                    Logger.debug(`[Loudness] Trying search: ${attemptUrl}`);
                    const ytDlp = spawnYtDlpAudioStream(attemptUrl);
                    measuredLUFS = await analyzeLoudnessFromStream(ytDlp);
                    Logger.debug(`[Loudness] Measured ${measuredLUFS.toFixed(1)} LUFS for ${cacheKey} via ${attemptUrl}`);
                    break;
                } catch (e) {
                    lastError = e;
                    Logger.debug(`[Loudness] Search failed for ${attemptUrl}: ${e.message}`);
                    continue;
                }
            }
            if (measuredLUFS === undefined) throw lastError || new Error("All YouTube search strategies failed");
        } else {
            const videoUrl = track.uri;
            const ytDlp = spawnYtDlpAudioStream(videoUrl);
            measuredLUFS = await analyzeLoudnessFromStream(ytDlp);
            Logger.debug(`[Loudness] Measured ${measuredLUFS.toFixed(1)} LUFS for ${cacheKey}`);
        }

        // Convert to gain multiplier
        const gainMultiplier = lufsToGainMultiplier(measuredLUFS);

        // Update cache with new sample
        const now = Date.now();
        const cached = loudnessCache.get(cacheKey) || { samples: [], avgGain: null, sampleCount: 0 };

        cached.samples.push({ measuredLUFS, gainMultiplier, analyzedAt: now });

        // Keep only last MAX_SAMPLES_PER_TRACK samples
        if (cached.samples.length > MAX_SAMPLES_PER_TRACK) {
            cached.samples = cached.samples.slice(-MAX_SAMPLES_PER_TRACK);
        }

        cached.sampleCount = cached.samples.length;

        // Calculate average gain from all stored samples
        cached.avgGain = cached.samples.reduce((sum, s) => sum + s.gainMultiplier, 0) / cached.samples.length;

        loudnessCache.set(cacheKey, cached);
        cacheDirty = true;

        Logger.info(`[Loudness] Analyzed ${cacheKey}: ${measuredLUFS.toFixed(1)} LUFS → gain ${gainMultiplier.toFixed(3)} (avg: ${cached.avgGain.toFixed(3)} from ${cached.sampleCount} samples)`);

        // Return the average gain (or single gain if only one sample)
        if (onComplete) onComplete(cached, cached.avgGain);
        return cached.avgGain;

    } catch (error) {
        Logger.error(`[Loudness] Analysis failed for ${cacheKey}:`, error.message);

        // Cache fallback gain to avoid retrying immediately
        const isMirrorSource = track.source === "spotify" || track.source === "applemusic" || track.source === "deezer";
        const isYouTubeSource = track.source === "youtube";
        let fallbackGain = 1.0;
        if (isMirrorSource) {
            fallbackGain = SPOTIFY_FALLBACK_GAIN;
        } else if (isYouTubeSource) {
            fallbackGain = YOUTUBE_FALLBACK_GAIN;
        }

        const cached = loudnessCache.get(cacheKey) || { samples: [], avgGain: fallbackGain, sampleCount: 0 };
        if (!cached.avgGain) cached.avgGain = fallbackGain;
        loudnessCache.set(cacheKey, cached);

        if (onComplete) onComplete(cached, cached.avgGain);
        return cached.avgGain;
    }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Get cached gain multiplier for a track (for use in trackStart)
 * Returns the averaged gain if available, otherwise uses Spotify fallback (0.5) for unanalyzed Spotify tracks, or 1.0
 */
function getCachedGain(track) {
    const cacheKey = getCacheKey(track);
    const cached = loudnessCache.get(cacheKey);

    // If we have cached data (average or samples), use it
    if (cached?.avgGain) return cached.avgGain;
    if (cached?.samples?.length) return cached.samples[cached.samples.length - 1].gainMultiplier;

    // No cached data - use appropriate fallback based on source
    const isMirrorSource = track.source === "spotify" || track.source === "applemusic" || track.source === "deezer";
    const isYouTubeSource = track.source === "youtube";

    if (isMirrorSource) {
        Logger.debug(`[Loudness] No cache for ${cacheKey}, using Spotify fallback gain: ${SPOTIFY_FALLBACK_GAIN}`);
        return SPOTIFY_FALLBACK_GAIN;
    }

    if (isYouTubeSource) {
        Logger.debug(`[Loudness] No cache for ${cacheKey}, using YouTube fallback gain: ${YOUTUBE_FALLBACK_GAIN}`);
        return YOUTUBE_FALLBACK_GAIN;
    }

    return 1.0;
}

/**
 * Get cache statistics for debugging
 */
function getCacheStats() {
    return {
        size: loudnessCache.size,
        queued: analysisQueue.length,
        active: activeAnalysisCount,
        entries: Array.from(loudnessCache.entries()).map(([key, value]) => ({
            key,
            sampleCount: value.sampleCount,
            avgGain: value.avgGain?.toFixed(3),
            latestGain: value.samples?.[value.samples.length - 1]?.gainMultiplier?.toFixed(3),
            hasError: !value.avgGain || value.avgGain === 1.0
        }))
    };
}

/**
 * Apply gain correction to player volume based on current track
 * Call this whenever baseVolume changes (manual volume adjustment)
 */
function applyGainCorrection(player, track, client) {
    if (!player || !track) return;

    const gainMultiplier = getCachedGain(track);
    const baseVolume = player.baseVolume ?? player.volume;

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
}

/**
 * Graceful shutdown - save cache before exit
 */
function shutdown() {
    isShuttingDown = true;
    stopAutoSave();
    saveCache();
    Logger.info("[Loudness] Shutdown complete, cache saved");
}

// ============================================================
// INITIALIZATION
// ============================================================

loadCache();
startAutoSave();

// Handle process termination
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

module.exports = {
    analyzeTrackLoudness: analyzeTrackLoudnessInternal,
    getCachedGain,
    queueLoudnessAnalysis,
    getCacheStats,
    applyGainCorrection,
    shutdown,
    getCacheKey,
    TARGET_LUFS,
    MIN_GAIN,
    MAX_GAIN,
    MAX_SAMPLES_PER_TRACK,
    MAX_CONCURRENT_ANALYSIS,
    loudnessCache
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */