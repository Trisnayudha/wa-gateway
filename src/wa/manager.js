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
            const client = new Client({
                authStrategy: new LocalAuth({ clientId: `device-${deviceId}` }),
                // Pin to stable WhatsApp Web build (2.3000.1036950040) to avoid "r: r" errors from WhatsApp Web 2.3000.1043+
                webVersion: "2.3000.1036950040",
                webVersionCache: {
                    type: "remote",
                    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
                },
                puppeteer: {
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--no-zygote",
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
