const { VoicePlugin } = require("rainlink-voice");
require("dotenv").config({ path: "./.env", quiet: true });

module.exports = {
    // GENERAL DETAILS
    token: process.env.TOKEN || " ", // your bot token
    prefix: process.env.PREFIX || "!", // your default prefix
    dev: ["312292652110577665"], // your Discord user Id & developer user Id
    embedColor: process.env.EMBED_COLOR || "5865F2", // your embeded hex color
    leaveTimeout: parseInt(process.env.LEAVE_TIMEOUT) || 60000, // leave timeout in milliseconds
    defaultVolume: parseInt(process.env.DEFAULT_VOLUME) || 50, // Default volume when bot joins a voice channel
    minVolume: parseInt(process.env.MIN_VOLUME) || 1, // min volume
    maxVolume: parseInt(process.env.MAX_VOLUME) || 100, // max volume
    maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 500, // max songs per guild queue (safety limit against spam)
    mongoUri: process.env.MONGO_URI || " ", // your MongoDB Uri
    supportServerUrl: process.env.SUPPORT_SERVER_URL || " ", // your support server url

    // RAINLINK DETAILS
    lavalinkSource: process.env.LAVALINK_SOURCE || "sp", // Available Lavalink sources, based on the sources you've enabled in your Lavalink configuration. For example, if you enable the Spotify source, then "sp" will refer to "spsearch". Will be used if "sourceID" option is provided in the play command.
    rainlinkOptions: {
        resume: true, // whether to resume the player after restart
        resumeTimeout: 5000, // 5 seconds
        retryTimeout: 5000, // 5 seconds
        retryCount: Infinity, // infinity or number
        defaultSearchEngine: process.env.DEFAULT_SEARCH_ENGINE || "youtubeMusic", // default search engine. Available engines: youtubeMusic, youtube,& soundcloud.
        searchFallback: {
            enable: true, // enable search fallback, don't change this if you don't know what you're doing
            engine: process.env.SEARCH_FALLBACK_ENGINE || "youtube", // search fallback engine, this is the engine that will be used when the default search engine fails and the search fallback is enabled. Available engines: youtubeMusic, youtube, and soundcloud
        },
    },
    rainlinkPlugins: [new VoicePlugin()], // rainlink plugins, to add more plugins, just add them to the array. Available plugins: https://github.com/RainyXeon/Rainlink/#-plugins
    rainlinkNodes: [
        {
            name: process.env.LAVALINK_NAME || "GodTeeTy",
            host: process.env.LAVALINK_HOST || "localhost",
            port: parseInt(process.env.LAVALINK_PORT) || 2333,
            auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
            secure: parseBoolean(process.env.LAVALINK_SECURE || "false"),
            driver: process.env.LAVALINK_DRIVER || "lavalink/v4/koinu", // Available drivers based on your Lavalink version: https://github.com/RainyXeon/Rainlink#-drivers
        },
    ],

    geminiApiKey: process.env.GEMINI_API_KEY || "",
    emojis: {
        // Progress Bar
        START_WH: "<:Start_WH:1550824319863492679>",
        START_BK: "<:Start_BK:1550824318223785984>",
        HALF_WH:  "<:Half_WH:1550824316633874482>",
        FULL_WH:  "<:Full_WH:1550824314423484416>",
        FULL_BK:  "<:Full_BK:1550824311751704638>",
        END_WH:   "<:End_WH:1550824309579055105>",
        END_BK:   "<:End_BK:1550824299873435658>",
        
        // Buttons
        ICON_PREV:    "<:btn_prev:1550839283911368757>",
        ICON_PLAY:    "<:btn_play:1550839282418196560>",
        ICON_RESUME:  "<:btn_resume:1551168722125717594>",
        ICON_PAUSE:   "<:btn_pause:1550839287765803092>",
        ICON_SKIP:    "<:btn_skip:1550839286042067066>",
        ICON_VOLDOWN: "<:btn_voldown:1550839276613271633>",
        ICON_VOLUP:   "<:btn_volup:1550839279649947658>",
        ICON_STOP:    "<:btn_stop:1550839275346731078>",
        
        // Sources
        ICON_SPOTIFY:    "<:spotify:1550848197981765723>",
        ICON_YOUTUBE:    "<:youtube:1550843332643655700>",
        ICON_SOUNDCLOUD: "<:soundcloud:1550843334287953940>",

        // System Action Icons
        ICON_SEARCH:   "<:Icon_Search:1551102501229559958>",
        ICON_WARNING:  "<:Icon_Warning:1551102499627212841>",
        ICON_ERROR:    "<:Icon_Error:1551102497735573555>",
        ICON_SUCCESS:  "<:Icon_Success:1551102495961387028>",
        ICON_PLAYLIST: "<:Icon_Playlist:1551102493579153408>",
        ICON_TIME:     "<:Icon_Time:1551102491523813477>",
        ICON_LOAD:     "<:Icon_Load:1551102489623924746>",
        ICON_LINK:	   "<:Icon_Link:1551495914428956682>",
        ICON_LEFTSL:   "<:Icon_LeftSelect:1551552149685669928>",
        ICON_CORRECT:  "<:Icon_Correct:1551554008966242315>",
        ICON_SAVE:     "<:Icon_Save:1551554006818488390>",
        ICON_EQ:       "<:Icon_EQ:1551571501839552513>"
    },

    // Custom EQ Profile for Punchy Bass and Sharp Vocals
    EQ: [
      { band: 0, gain: 0.0 },  // Deep Bass: Reduce to 0.10 - 0.15 if the audio distorts
      { band: 1, gain: 0.0 },  // Mid Bass: Reduce to 0.10 - 0.15 if the audio distorts
	  { band: 2, gain: -0.02 },
	  { band: 3, gain: -0.06 },
	  { band: 4, gain: -0.08 },
      { band: 5, gain: -0.11 }, // Slight dip to remove muddy frequencies
      { band: 6, gain: -0.11 },
	  { band: 7, gain: -0.08 },
	  { band: 8, gain: -0.08 },
	  { band: 9, gain: -0.06 },
	  { band: 10, gain: -0.03 },
      { band: 11, gain: 0.03 }, // Vocal sharpness
      { band: 12, gain: 0.04 }, // Treble
      { band: 13, gain: 0.06 }, // Air/Cymbals
      { band: 14, gain: 0.06 }
    ],
};

function parseBoolean(value) {
    if (typeof value === "string") value = value.trim().toLowerCase();

    switch (value) {
        case "true":
            return true;
        case "false":
            return false;
        default:
            return false;
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
