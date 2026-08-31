/**
 * Skip-loop guard to prevent auto-skipping too many tracks in sequence
 * Tracks consecutive errors per guild and stops playback if threshold exceeded
 */

const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_COUNTER_KEY = (guildId) => `skip_errors_${guildId}`;

/**
 * Increment error counter for a guild
 */
function incrementErrorCount(client, guildId) {
    const key = ERROR_COUNTER_KEY(guildId);
    const current = client.data.get(key) || 0;
    client.data.set(key, current + 1);
    return current + 1;
}

/**
 * Reset error counter for a guild (called on successful trackStart)
 */
function resetErrorCount(client, guildId) {
    const key = ERROR_COUNTER_KEY(guildId);
    client.data.delete(key);
}

/**
 * Get current error count for a guild
 */
function getErrorCount(client, guildId) {
    const key = ERROR_COUNTER_KEY(guildId);
    return client.data.get(key) || 0;
}

/**
 * Check if should skip or stop playback based on error count
 * Returns: 'skip' if under threshold, 'stop' if threshold exceeded, null if no player
 */
function shouldSkipOrStop(client, player) {
    if (!player) return null;
    
    const errorCount = incrementErrorCount(client, player.guildId);
    
    if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
        return 'stop';
    }
    
    return 'skip';
}

module.exports = {
    incrementErrorCount,
    resetErrorCount,
    getErrorCount,
    shouldSkipOrStop,
    MAX_CONSECUTIVE_ERRORS,
};

/**
 * Project: Lunox
 * Author: adh319
 * Company: EnourDev
 * This code is the property of EnourDev and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/xhTVzbS5NU
 */
