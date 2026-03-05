const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { Device } = require("../db/models");

class WaManager {
    constructor() {
        this.clients = new Map(); // deviceId -> Client
        this.qrMap = new Map(); // deviceId -> dataURL
    }

    async initFromDb() {
        const devices = await Device.findAll();
        for (const d of devices) this.ensureClient(d.id);
    }

    // dipakai endpoint /api/groups
    getClient(deviceId) {
        return this.clients.get(deviceId) || null;
    }

    async restart(deviceId) {
        const client = this.clients.get(deviceId);
        try {
            if (client) await client.destroy();
        } catch (e) {
            // ignore
        }

        this.clients.delete(deviceId);
        this.qrMap.delete(deviceId);

        await Device.update(
            { status: "DISCONNECTED", last_event: "restarting" },
            { where: { id: deviceId } }
        );

        this.ensureClient(deviceId);
        return true;
    }

    ensureClient(deviceId) {
        if (this.clients.has(deviceId)) return this.clients.get(deviceId);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: `device-${deviceId}` }),
            // puppeteer: { headless: true }, // optional
        });

        client.on("qr", async (qr) => {
            const dataUrl = await qrcode.toDataURL(qr);
            this.qrMap.set(deviceId, dataUrl);
            await Device.update(
                { status: "DISCONNECTED", last_event: "qr" },
                { where: { id: deviceId } }
            );
        });

        client.on("authenticated", async () => {
            await Device.update({ last_event: "authenticated" }, { where: { id: deviceId } });
        });

        client.on("ready", async () => {
            this.qrMap.delete(deviceId);
            await Device.update(
                { status: "READY", last_event: "ready" },
                { where: { id: deviceId } }
            );
        });

        client.on("disconnected", async (reason) => {
            await Device.update(
                { status: "DISCONNECTED", last_event: `disconnected:${reason}` },
                { where: { id: deviceId } }
            );
        });

        client.on("auth_failure", async (msg) => {
            await Device.update(
                { status: "DISCONNECTED", last_event: `auth_failure:${msg}` },
                { where: { id: deviceId } }
            );
        });

        client.initialize();

        this.clients.set(deviceId, client);
        return client;
    }

    getQr(deviceId) {
        return this.qrMap.get(deviceId) || null;
    }

    /**
     * Normalize destination id:
     * - If already contains @c.us / @g.us -> keep as-is (no stripping)
     * - If looks like group id (starts with 120..., long) -> append @g.us
     * - Else treat as phone number -> keep digits -> append @c.us
     */
    normalizeTo(to) {
        const raw = String(to || "").trim();
        if (!raw) return "";

        // already jid
        if (raw.includes("@c.us") || raw.includes("@g.us")) return raw;

        // group heuristic (common)
        const digitsOnly = raw.replace(/\D/g, "");
        const looksLikeGroup = digitsOnly.startsWith("120") && digitsOnly.length >= 15;
        if (looksLikeGroup) return `${digitsOnly}@g.us`;

        // phone number
        if (!digitsOnly) return "";
        return `${digitsOnly}@c.us`;
    }

    async sendText(deviceId, to, text) {
        const client = this.clients.get(deviceId);
        if (!client) throw new Error("Device client not found");

        // pastikan client sudah ready beneran
        if (!client.info) throw new Error("Device not ready (client.info missing)");

        const chatId = this.normalizeTo(to);
        if (!chatId) throw new Error("Invalid 'to' value");

        // kalau nomor (bukan group), optional cek terdaftar
        if (chatId.endsWith("@c.us") && typeof client.isRegisteredUser === "function") {
            const ok = await client.isRegisteredUser(chatId);
            if (!ok) throw new Error("Invalid phone number or the number is not registered on WhatsApp");
        }

        // SAFE PATH: get chat dulu, baru send
        if (typeof client.getChatById === "function") {
            const chat = await client.getChatById(chatId);
            if (!chat) throw new Error("Chat not found (group/user not accessible from this device)");

            return chat.sendMessage(String(text));
        }

        // fallback (kalau versi whatsapp-web.js kamu ga punya getChatById)
        return client.sendMessage(chatId, String(text));
    }
}

module.exports = new WaManager();