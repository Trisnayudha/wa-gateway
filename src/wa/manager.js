const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { Device } = require("../db/models");
const commandHandler = require("./commandHandler"); // ✅ TAMBAHAN

class WaManager {
    constructor() {
        this.clients = new Map();       // deviceId -> Client
        this.qrMap = new Map();         // deviceId -> QR dataURL
        this.initializing = new Map();  // deviceId -> Promise<Client>
    }

    async initFromDb() {
        const devices = await Device.findAll();

        for (const d of devices) {
            try {
                await this.ensureClient(d.id);
            } catch (err) {
                console.error(`Init failed for device ${d.id}:`, err.message);
            }
        }
    }

    getClient(deviceId) {
        return this.clients.get(deviceId) || null;
    }

    getQr(deviceId) {
        return this.qrMap.get(deviceId) || null;
    }

    async restart(deviceId) {
        const client = this.clients.get(deviceId);

        try {
            if (client) await client.destroy();
        } catch (e) {
            console.error(`Destroy failed on restart [${deviceId}]:`, e.message);
        }

        this.clients.delete(deviceId);
        this.qrMap.delete(deviceId);
        this.initializing.delete(deviceId);

        await Device.update(
            { status: "DISCONNECTED", last_event: "restarting" },
            { where: { id: deviceId } }
        );

        return this.ensureClient(deviceId);
    }

    async ensureClient(deviceId) {
        if (this.clients.has(deviceId)) return this.clients.get(deviceId);
        if (this.initializing.has(deviceId)) return this.initializing.get(deviceId);

        const initPromise = (async () => {
            // Bersihkan stale SingletonLock dari crash sebelumnya agar tidak muncul error "browser is already running"
            try {
                const lockPath = path.join(process.cwd(), ".wwebjs_auth", `session-device-${deviceId}`, "SingletonLock");
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                }
            } catch (_) {}

            const client = new Client({
                authStrategy: new LocalAuth({ clientId: `device-${deviceId}` }),
                puppeteer: {
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-extensions",
                        "--disable-background-networking",
                        "--disable-default-apps",
                        "--disable-sync",
                        "--disable-translate",
                        "--hide-scrollbars",
                        "--metrics-recording-only",
                        "--mute-audio",
                        "--no-first-run",
                        "--safebrowsing-disable-auto-update",
                        "--disable-features=IsolateOrigins,site-per-process",
                        "--disable-site-isolation-trials",
                    ],
                },
            });

            this.clients.set(deviceId, client);

            client.on("qr", async (qr) => {
                try {
                    const dataUrl = await qrcode.toDataURL(qr);
                    this.qrMap.set(deviceId, dataUrl);
                    await Device.update(
                        { status: "DISCONNECTED", last_event: "qr" },
                        { where: { id: deviceId } }
                    );
                } catch (err) {
                    console.error(`QR handler error [${deviceId}]:`, err.message);
                }
            });

            client.on("authenticated", async () => {
                try {
                    await Device.update(
                        { last_event: "authenticated" },
                        { where: { id: deviceId } }
                    );
                } catch (err) {
                    console.error(`Authenticated handler error [${deviceId}]:`, err.message);
                }
            });

            client.on("ready", async () => {
                try {
                    this.qrMap.delete(deviceId);
                    await Device.update(
                        { status: "READY", last_event: "ready" },
                        { where: { id: deviceId } }
                    );
                } catch (err) {
                    console.error(`Ready handler error [${deviceId}]:`, err.message);
                }
            });

            client.on("disconnected", async (reason) => {
                try {
                    this.qrMap.delete(deviceId);
                    this.clients.delete(deviceId);
                    this.initializing.delete(deviceId);
                    await Device.update(
                        { status: "DISCONNECTED", last_event: `disconnected:${reason}` },
                        { where: { id: deviceId } }
                    );
                } catch (err) {
                    console.error(`Disconnected handler error [${deviceId}]:`, err.message);
                } finally {
                    // Selalu destroy Chromium agar tidak jadi zombie process
                    try { await client.destroy(); } catch (_) {}
                }
            });

            client.on("auth_failure", async (msg) => {
                try {
                    this.qrMap.delete(deviceId);
                    this.clients.delete(deviceId);
                    this.initializing.delete(deviceId);
                    await Device.update(
                        { status: "DISCONNECTED", last_event: `auth_failure:${msg}` },
                        { where: { id: deviceId } }
                    );
                } catch (err) {
                    console.error(`Auth failure handler error [${deviceId}]:`, err.message);
                } finally {
                    try { await client.destroy(); } catch (_) {}
                }
            });

            // ✅ MESSAGE HANDLER — delegasi ke commandHandler dengan deviceId
            client.on("message", async (message) => {
                try {
                    if (message.fromMe) return;
                    await commandHandler.handle(message, client, deviceId);
                } catch (err) {
                    console.error(`Message handler error [${deviceId}]:`, err.message);
                }
            });

            try {
                await client.initialize();
            } catch (err) {
                this.clients.delete(deviceId);
                this.qrMap.delete(deviceId);
                throw err;
            }

            return client;
        })();

        this.initializing.set(deviceId, initPromise);

        try {
            return await initPromise;
        } finally {
            this.initializing.delete(deviceId);
        }
    }

    normalizeTo(to) {
        const raw = String(to || "").trim();
        if (!raw) return "";

        if (raw.includes("@c.us") || raw.includes("@g.us")) return raw;

        const digitsOnly = raw.replace(/\D/g, "");
        const looksLikeGroup = digitsOnly.startsWith("120") && digitsOnly.length >= 15;
        if (looksLikeGroup) return `${digitsOnly}@g.us`;

        if (!digitsOnly) return "";
        return `${digitsOnly}@c.us`;
    }

    // Resolves to WhatsApp's own canonical WID (via getNumberId) instead of trusting our
    // locally-built "<digits>@c.us" string, since the two can diverge for numbers on
    // newer WhatsApp addressing schemes and that mismatch alone can break chat creation.
    async resolveChatId(client, to) {
        const chatId = this.normalizeTo(to);
        if (!chatId) throw new Error("Invalid 'to' value");

        if (!chatId.endsWith("@c.us") || typeof client.getNumberId !== "function") {
            return chatId;
        }

        const numberId = await client.getNumberId(chatId);
        if (!numberId) throw new Error("Invalid phone number or not registered on WhatsApp");

        return numberId._serialized || chatId;
    }

    // whatsapp-web.js sometimes rejects new-chat creation with a bare, non-descriptive
    // thrown value (e.g. a single character) instead of a real Error - this happens when
    // WhatsApp blocks this automated session from starting a conversation with a number
    // it has no prior history with. Surface that plainly instead of the raw fragment.
    wrapChatError(err, chatId) {
        if (err instanceof Error && err.message && err.message.length > 3) return err;

        const raw = String(err?.message ?? err ?? "").trim();
        if (raw.length > 3) return new Error(raw, { cause: err });

        return new Error(
            `Gagal membuat chat baru ke ${chatId}. WhatsApp kemungkinan membatasi device ini untuk memulai percakapan baru dengan nomor yang belum pernah chat sebelumnya. Minta nomor tujuan mengirim pesan lebih dulu, atau kirim ke nomor yang device ini sudah pernah chat.`,
            { cause: err }
        );
    }

    async sendText(deviceId, to, text) {
        const client = this.clients.get(deviceId);
        if (!client) throw new Error("Device client not found");
        if (!client.info) throw new Error("Device not ready");

        const chatId = await this.resolveChatId(client, to);

        try {
            return await client.sendMessage(chatId, String(text));
        } catch (err) {
            throw this.wrapChatError(err, chatId);
        }
    }

    async sendAttachment(deviceId, to, attachment) {
        const client = this.clients.get(deviceId);
        if (!client) throw new Error("Device client not found");
        if (!client.info) throw new Error("Device not ready");

        const chatId = await this.resolveChatId(client, to);

        const url = String(attachment?.url || "").trim();
        if (!url) throw new Error("attachmentUrl is required");

        const media = await MessageMedia.fromUrl(url, {
            unsafeMime: true,
            filename: attachment?.filename || undefined,
        });

        if (!media) throw new Error("Failed to load attachment from URL");

        const caption = String(attachment?.caption || "").trim();

        try {
            return await client.sendMessage(chatId, media, caption ? { caption } : undefined);
        } catch (err) {
            throw this.wrapChatError(err, chatId);
        }
    }

    // Mengambil semua grup WhatsApp tanpa memanggil getChatModel() yang melempar error "r"
    // Menggabungkan data dari Chat collection dan GroupMetadata collection agar semua grup terambil lengkap
    async getGroupChats(deviceId) {
        const client = this.clients.get(deviceId);
        if (!client) throw new Error("Device client not found");
        if (!client.info) throw new Error("Device not ready");

        return client.pupPage.evaluate(async () => {
            const collections = window.require ? window.require("WAWebCollections") : null;
            if (!collections) return [];

            const Chat = collections.Chat || collections.WAWebChatCollection;
            const GroupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
            const WidFactory = window.require ? window.require("WAWebWidFactory") : null;

            const createWid = (raw) => {
                try {
                    return WidFactory ? WidFactory.createWid(raw) : null;
                } catch (_) {
                    return null;
                }
            };

            const getCount = (gm) => {
                if (!gm) return null;
                if (typeof gm.size === "number" && gm.size > 0) return gm.size;
                const p = gm.participants;
                if (p) {
                    if (typeof p.length === "number" && p.length > 0) return p.length;
                    if (typeof p.size === "number" && p.size > 0) return p.size;
                    if (Array.isArray(p) && p.length > 0) return p.length;
                    if (Array.isArray(p._models) && p._models.length > 0) return p._models.length;
                    if (Array.isArray(p.models) && p.models.length > 0) return p.models.length;
                    try {
                        if (typeof p.serialize === "function") {
                            const s = p.serialize();
                            if (Array.isArray(s) && s.length > 0) return s.length;
                        }
                    } catch (_) {}
                    try {
                        if (typeof p.getModelsArray === "function") {
                            const arr = p.getModelsArray();
                            if (Array.isArray(arr) && arr.length > 0) return arr.length;
                        }
                    } catch (_) {}
                }
                try {
                    if (typeof gm.serialize === "function") {
                        const s = gm.serialize();
                        if (Array.isArray(s?.participants) && s.participants.length > 0) return s.participants.length;
                        if (typeof s?.size === "number" && s.size > 0) return s.size;
                    }
                } catch (_) {}
                return null;
            };

            const groupsMap = new Map();

            // 1. Ambil dari Chat collection
            if (Chat && typeof Chat.getModelsArray === "function") {
                const chats = Chat.getModelsArray();
                for (const c of chats) {
                    try {
                        const rawId = c.id?._serialized || (typeof c.id === "string" ? c.id : null);
                        const isGroup = Boolean(c.isGroup || (rawId && rawId.endsWith("@g.us")));
                        if (!isGroup || !rawId) continue;

                        const name = c.formattedTitle || c.name || c.contact?.name || c.contact?.pushname || rawId;

                        let gm = c.groupMetadata;
                        if (!gm && GroupMetadata) {
                            try {
                                const wid = createWid(rawId);
                                gm = (wid ? GroupMetadata.get(wid) : null) || GroupMetadata.get(rawId) || null;
                            } catch (_) {}
                        }

                        const count = getCount(gm);

                        groupsMap.set(rawId, {
                            id: { _serialized: rawId },
                            name: name,
                            formattedTitle: name,
                            participants: count,
                            groupMetadata: {
                                participants: count !== null ? new Array(count) : [],
                            },
                        });
                    } catch (_) {}
                }
            }

            // 2. Ambil dari GroupMetadata collection (mencakup grup yang belum aktif di chat list)
            if (GroupMetadata && typeof GroupMetadata.getModelsArray === "function") {
                try {
                    const gmList = GroupMetadata.getModelsArray();
                    for (const gm of gmList) {
                        try {
                            const rawId = gm.id?._serialized || (typeof gm.id === "string" ? gm.id : null);
                            if (!rawId || !rawId.endsWith("@g.us")) continue;

                            const count = getCount(gm);

                            if (!groupsMap.has(rawId)) {
                                let title = gm.subject || null;
                                if (!title && Chat && typeof Chat.get === "function") {
                                    try {
                                        const wid = createWid(rawId);
                                        const c = (wid ? Chat.get(wid) : null) || Chat.get(rawId);
                                        title = c?.formattedTitle || c?.name;
                                    } catch (_) {}
                                }

                                groupsMap.set(rawId, {
                                    id: { _serialized: rawId },
                                    name: title || rawId,
                                    formattedTitle: title || rawId,
                                    participants: count,
                                    groupMetadata: {
                                        participants: count !== null ? new Array(count) : [],
                                    },
                                });
                            } else {
                                const existing = groupsMap.get(rawId);
                                if ((existing.participants === null || existing.participants === 0) && count !== null) {
                                    existing.participants = count;
                                    existing.groupMetadata.participants = new Array(count);
                                }
                                if ((!existing.name || existing.name === rawId) && gm.subject) {
                                    existing.name = gm.subject;
                                    existing.formattedTitle = gm.subject;
                                }
                            }
                        } catch (_) {}
                    }
                } catch (_) {}
            }

            return Array.from(groupsMap.values());
        });
    }

    async destroyAll() {
        for (const [deviceId, client] of this.clients.entries()) {
            try {
                console.log(`Destroying client ${deviceId}...`);
                await client.destroy();
            } catch (err) {
                console.error(`Destroy failed [${deviceId}]:`, err.message);
            }
        }

        this.clients.clear();
        this.qrMap.clear();
        this.initializing.clear();
    }
}

module.exports = new WaManager();
