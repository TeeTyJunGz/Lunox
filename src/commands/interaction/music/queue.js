const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { convertTime } = require("../../../functions/timeFormat.js");

const parseEmoji = (str) => {
    if (!str) return null;
    const match = str.match(/<?(a)?:?(\w{2,32}):(\d{17,19})>?/);
    return match ? { animated: Boolean(match[1]), name: match[2], id: match[3] } : { name: str };
};

module.exports = {
    name: "queue",
    description: "Show the queue list",
    category: "music",
    permissions: {
        bot: [],
        user: [],
    },
    settings: {
        voice: true,
        player: true,
        current: true,
    },
    devOnly: false,
    run: async (client, interaction, player) => {
        if (player.queue.isEmpty) {
            return interaction.reply({
                // 32832 = 32768 (V2 Components) + 64 (Ephemeral) combined safely
                flags: 32832, 
                components: [{
                    type: 17, 
                    components: [{ type: 10, content: "The queue is currently empty." }]
                }]
            });
        }

        // 1. Silently acknowledge the interaction so Discord doesn't timeout
        await interaction.reply({ content: "Generating live queue...", flags: [MessageFlags.Ephemeral] });

        // 2. Destroy any existing queue GUI for this player to prevent duplicates
        if (player.queueUI) {
            await player.queueUI.destroy();
        }

        const e = client.emoji;
        const ICON_SETTING = e.system.setting || "≡";
        const ICON_TRIL = e.system.trackLeft || "◀";
        const ICON_X = e.system.close || "✖";
        const ICON_TRIR = e.system.trackRight || "▶";
        
        const ICON_PLAY = e.buttons.play || "▶";
        const ICON_RESUME = e.buttons.resume || "⏭";
        const ICON_PLX = e.system.playlistExtended || "🗑";

        const tracksPerPage = 5;

        // --- Payload Builders ---
        const buildQueuePayload = (page) => {
            const queueArray = player.queue.map(t => t);
            if (queueArray.length === 0) return null;

            const maxPages = Math.ceil(queueArray.length / tracksPerPage) || 1;
            if (page > maxPages) page = maxPages;
            if (page < 1) page = 1;

            const start = (page - 1) * tracksPerPage;
            const end = start + tracksPerPage;
            const currentTracks = queueArray.slice(start, end);

            const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
            const sections = [];

            currentTracks.forEach((track, i) => {
                const trackIndex = start + i;
                const trackDuration = track.isStream ? "LIVE" : convertTime(track.duration);
                const title = formatString(track.title || "Unknown", 40).replace(/ - Topic$/, "");
                const artist = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");
                
                const requesterId = track.requester && track.requester.id ? `<@${track.requester.id}>` : track.requester;
                const trackNumber = String(trackIndex + 1).padStart(2, '0');

                sections.push({
                    type: 9, 
                    components: [
                        { type: 10, content: `\`${trackDuration}\` [${title}](<${track.uri}>) — ${artist}\n-# **#${trackNumber}.** Requested by ${requesterId}` }
                    ],
                    accessory: {
                        type: 2, 
                        style: 2, 
                        emoji: parseEmoji(ICON_SETTING),
                        custom_id: `edit_${trackIndex}`
                    }
                });

                if (i < currentTracks.length - 1) {
                    sections.push({ type: 14, spacing: 1 });
                }
            });

            sections.push({ type: 10, content: `\nPage ${page}/${maxPages} (${queueArray.length} total)` });
            const container = { type: 17, components: sections };

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("prev_page").setEmoji(ICON_TRIL).setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
                new ButtonBuilder().setCustomId("close_queue").setEmoji(ICON_X).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("next_page").setEmoji(ICON_TRIR).setStyle(ButtonStyle.Secondary).setDisabled(page === maxPages)
            ).toJSON();

            return { flags: 32768, components: [container, row], allowedMentions: { parse: [] } };
        };

        const buildEditPopup = (track, trackIndex) => {
            const formatString = (str, maxLength) => (str.length > maxLength ? str.substr(0, maxLength - 3) + "..." : str);
            const title = formatString(track.title || "Unknown", 40).replace(/ - Topic$/, "");
            const artist = formatString(track.author || "Unknown", 30).replace(/ - Topic$/, "");
            const requesterId = track.requester && track.requester.id ? `<@${track.requester.id}>` : track.requester;

            const section = {
                type: 9,
                components: [
                    { type: 10, content: `[${title}](<${track.uri}>) — ${artist}\n\n• Requested by ${requesterId}` }
                ]
            };

            if (track.artworkUrl) section.accessory = { type: 11, media: { url: track.artworkUrl } };

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`playnow_${trackIndex}`).setLabel("Play Now").setEmoji(ICON_PLAY).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`playnext_${trackIndex}`).setLabel("Play Next").setEmoji(ICON_RESUME).setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`remove_${trackIndex}`).setLabel("Remove").setEmoji(ICON_PLX).setStyle(ButtonStyle.Secondary)
            ).toJSON();

            return { flags: 32768, components: [{ type: 17, components: [section, { type: 14, spacing: 1 }, row] }], allowedMentions: { parse: [] } };
        };

        // ==========================================
        // 🚀 EVENT-DRIVEN GUI STATE CONTROLLER
        // ==========================================
        player.queueUI = {
            message: null,
            collector: null,
            currentPage: 1,
            debounce: null,
            isClosed: false, // <-- MEMORY FLAG: Track if the user explicitly killed it
            
            destroy: async function() {
                this.isClosed = true; // Instantly mark as dead
                if (this.collector) {
                    this.collector.stop();
                    this.collector = null;
                }
                if (this.message) {
                    await this.message.delete().catch(() => {});
                    this.message = null;
                }
            },
            
            update: async function(hardRender = false) {
                // Safety check: if it was closed, DO NOT update or respawn
                if (this.isClosed) return;

                // If queue is completely emptied naturally, destroy the GUI entirely
                if (!player || player.queue.isEmpty) {
                    await this.destroy();
                    return;
                }

                // Safe Bound Checking
                const maxPages = Math.ceil(player.queue.size / tracksPerPage) || 1;
                if (this.currentPage > maxPages) this.currentPage = maxPages;
                if (this.currentPage < 1) this.currentPage = 1;

                const payload = buildQueuePayload(this.currentPage);
                if (!payload) return;

                if (hardRender) {
                    // Hard Render: Deletes old GUI, sends fresh one to the absolute bottom of chat
                    await this.destroy();
                    
                    // Since destroy() sets it to closed, we must flip it back to false here
                    // because this is a legitimate active update, not a user cancellation.
                    this.isClosed = false; 
                    
                    try {
                        this.message = await client.channels.cache.get(player.textId).send(payload);
                        this.collector = this.message.createMessageComponentCollector();
                        this.collector.on("collect", handleInteraction);
                    } catch (e) {}
                } else {
                    // Soft Render: Edits in place without jumping down (Used for page turning < >)
                    if (this.message) {
                        await this.message.edit(payload).catch(() => {});
                    }
                }
            }
        };

        // ==========================================
        // 🧠 MONKEY PATCH: NO TIMERS. PURE EVENTS.
        // ==========================================
        if (!player._isPatchedForUI) {
            const mutators = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'add', 'remove', 'clear', 'shuffle'];
            
            mutators.forEach(method => {
                if (typeof player.queue[method] === 'function') {
                    const original = player.queue[method];
                    
                    player.queue[method] = function(...args) {
                        const res = original.apply(this, args);
                        
                        // It checks !player.queueUI.isClosed so it ignores background shifts when dead
                        if (player.queueUI && !player.queueUI.isClosed && typeof player.queueUI.update === 'function') {
                            clearTimeout(player.queueUI.debounce);
                            player.queueUI.debounce = setTimeout(() => {
                                player.queueUI.update(true); 
                            }, 200);
                        }
                        
                        return res;
                    };
                }
            });

            player._isPatchedForUI = true;
        }

        // ==========================================
        // 🕹️ INTERACTION HANDLER
        // ==========================================
        async function handleInteraction(i) {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: "You cannot interact with this menu.", flags: [MessageFlags.Ephemeral] });
            }

            if (player.queue.isEmpty) {
                return player.queueUI.destroy();
            }

            // --- SOFT RENDER: Page Turns (Stay in place) ---
            if (i.customId === "prev_page" || i.customId === "next_page") {
                if (i.customId === "prev_page") player.queueUI.currentPage--;
                if (i.customId === "next_page") player.queueUI.currentPage++;
                
                await i.deferUpdate();
                player.queueUI.update(false); 
            } 
            // --- CLOSE ---
            else if (i.customId === "close_queue") {
                await i.deferUpdate();
                player.queueUI.destroy(); // Explicit user close
            } 
            // --- POPUP MENU ---
            else if (i.customId.startsWith("edit_")) {
                const trackIndex = parseInt(i.customId.split("_")[1]);
                const trackArray = player.queue.map(t => t);
                const track = trackArray[trackIndex];
                
                if (!track) return i.reply({ content: "Track no longer exists in queue.", flags: [MessageFlags.Ephemeral] });

                const popupPayload = buildEditPopup(track, trackIndex);
                // Force combination of V2 + Ephemeral flag to avoid Discord.js overrides
                popupPayload.flags = 32832; 

                const popupMsg = await i.reply({ ...popupPayload, withResponse: true });
                const popupCollector = popupMsg.createMessageComponentCollector({ time: 60000 });

                popupCollector.on("collect", async (pi) => {
                    if (pi.user.id !== interaction.user.id) return pi.deferUpdate();

                    const pTrackIndex = parseInt(pi.customId.split("_")[1]);
                    const currentQueue = player.queue.map(t => t);
                    const pTrack = currentQueue[pTrackIndex];

                    if (!pTrack) {
                        await pi.deferUpdate();
                        return i.deleteReply().catch(() => {}); 
                    }

                    await pi.deferUpdate();

                    if (pi.customId.startsWith("playnow_")) {
                        player.queue.splice(pTrackIndex, 1);
                        player.queue.unshift(pTrack);
                        await player.skip();
                    } else if (pi.customId.startsWith("playnext_")) {
                        player.queue.splice(pTrackIndex, 1);
                        player.queue.unshift(pTrack);
                    } else if (pi.customId.startsWith("remove_")) {
                        player.queue.splice(pTrackIndex, 1);
                    }

                    await i.deleteReply().catch(() => {});
                });
            }
        }

        // Finally, delete the "Generating..." placeholder and execute the first Hard Render
        await interaction.deleteReply().catch(() => {}); 
        await player.queueUI.update(true);
    },
};
