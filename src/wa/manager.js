const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { Device } = require("../db/models");

class WaManager {
    constructor() {
        this.clients = new Map(); // deviceId -> Client
        this.qrMap = new Map();   // deviceId -> dataURL
    }

    async initFromDb() {
        const devices = await Device.findAll();
        for (const d of devices) this.ensureClient(d.id);
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
            await Device.update({ status: "DISCONNECTED", last_event: "qr" }, { where: { id: deviceId } });
        });

        client.on("authenticated", async () => {
            await Device.update({ last_event: "authenticated" }, { where: { id: deviceId } });
        });

        client.on("ready", async () => {
            this.qrMap.delete(deviceId);
            await Device.update({ status: "READY", last_event: "ready" }, { where: { id: deviceId } });
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

    async sendText(deviceId, to, text) {
        const client = this.clients.get(deviceId);
        if (!client) throw new Error("Device client not found");

        const number = String(to).replace(/\D/g, "");
        if (!number) throw new Error("Invalid 'to' number");

        const chatId = number.endsWith("@c.us") ? number : `${number}@c.us`;
        return client.sendMessage(chatId, text);
    }
}

module.exports = new WaManager();