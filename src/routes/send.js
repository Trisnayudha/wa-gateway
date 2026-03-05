// routes/api.js (atau file router kamu yang sekarang)
// POST /api/send  (Header: X-API-KEY)
// Body: { to, text }

const express = require("express");
const authApiKey = require("../middleware/auth");

const { Device, Message } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

/**
 * Normalize destination:
 * - If already has @c.us / @g.us → keep
 * - If looks like WhatsApp group id (starts with 120..., long) → add @g.us
 * - Else → treat as phone number and add @c.us
 */
function normalizeTo(to) {
    let t = String(to || "").trim();

    if (!t) return t;

    // already full jid
    if (t.includes("@c.us") || t.includes("@g.us")) return t;

    // detect group id (commonly starts with 120... and long)
    const looksLikeGroup = t.startsWith("120") && t.length >= 15;

    if (looksLikeGroup) return `${t}@g.us`;

    // treat as phone number (expect 62xxxx etc)
    // NOTE: do not auto-convert 08xxx here (your system may already store 62 format)
    return `${t}@c.us`;
}

/**
 * Map low-level WA errors into friendly API messages
 */
function mapSendError(err, toNormalized) {
    const msg = String(err?.message || err || "").trim();

    const isGroup = String(toNormalized || "").includes("@g.us");

    // whatsapp-web.js-ish common cases
    if (msg.includes("No LID for user")) {
        return isGroup
            ? "Group not found or your device is not a member of the group"
            : "Invalid phone number or the number is not registered on WhatsApp";
    }

    if (msg.toLowerCase().includes("not a member") || msg.toLowerCase().includes("not participant")) {
        return "Your device is not a member of the group";
    }

    if (msg.toLowerCase().includes("forbidden") || msg.toLowerCase().includes("not allowed")) {
        return isGroup
            ? "Message not allowed in this group (only admins can send messages)"
            : "Message not allowed";
    }

    if (msg.toLowerCase().includes("device not ready") || msg.toLowerCase().includes("not ready")) {
        return "Device not ready";
    }

    if (msg.toLowerCase().includes("disconnected") || msg.toLowerCase().includes("session")) {
        return "Device disconnected. Please reconnect/scan again.";
    }

    return msg || "Send failed";
}

router.post("/send", authApiKey, async (req, res) => {
    const { to, text } = req.body || {};
    if (!to || !text) {
        return res.status(400).json({ ok: false, message: "body required: {to, text}" });
    }

    const device = await Device.findByPk(req.deviceId);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });
    if (device.status !== "READY") return res.status(503).json({ ok: false, message: "Device not ready" });

    const toNormalized = normalizeTo(to);

    try {
        // IMPORTANT: kirim pakai toNormalized supaya group bisa (@g.us)
        const msg = await wa.sendText(req.deviceId, toNormalized, text);

        await Message.create({
            device_id: req.deviceId,
            to_number: String(toNormalized),
            text: String(text),
            status: "SENT",
            error: null,
        });

        return res.json({
            ok: true,
            deviceId: req.deviceId,
            to: toNormalized,
            messageId: msg?.id?._serialized || null,
        });
    } catch (err) {
        const friendly = mapSendError(err, toNormalized);

        await Message.create({
            device_id: req.deviceId,
            to_number: String(toNormalized),
            text: String(text),
            status: "FAILED",
            error: friendly,
        });

        // 400 kalau input/tujuan invalid, 500 kalau error internal umum
        const isClientError =
            friendly.toLowerCase().includes("invalid phone") ||
            friendly.toLowerCase().includes("not registered") ||
            friendly.toLowerCase().includes("group not found") ||
            friendly.toLowerCase().includes("not a member") ||
            friendly.toLowerCase().includes("not allowed");

        return res.status(isClientError ? 400 : 500).json({
            ok: false,
            to: toNormalized,
            message: friendly,
        });
    }
});
// GET /api/groups
router.get("/groups", authApiKey, async (req, res) => {
    try {
        // pastikan wa punya method untuk ambil client by deviceId
        // contoh: wa.getClient(deviceId)
        const client = wa.getClient(req.deviceId);
        if (!client) return res.status(503).json({ ok: false, message: "Client not ready" });

        const chats = await client.getChats();
        const groups = chats
            .filter((c) => c.isGroup)
            .map((g) => ({
                name: g.name,
                id: g.id?._serialized,   // INI yang dipakai untuk kirim
                participants: g.participants?.length ?? null,
            }));

        return res.json({ ok: true, deviceId: req.deviceId, groups });
    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message || "Failed to fetch groups" });
    }
});

module.exports = router;