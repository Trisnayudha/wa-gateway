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

    // remove spaces, dashes, parentheses, etc
    t = t.replace(/[^\d]/g, "");

    // detect group id (commonly starts with 120... and long)
    const looksLikeGroup = t.startsWith("120") && t.length >= 15;
    if (looksLikeGroup) return `${t}@g.us`;

    // normalize Indonesian phone number
    if (t.startsWith("08")) {
        t = "62" + t.slice(1); // 0838xxx -> 62838xxx
    } else if (t.startsWith("8")) {
        t = "62" + t; // 838xxx -> 62838xxx
    } else if (t.startsWith("620")) {
        t = "62" + t.slice(3); // antisipasi input aneh: 620838xxx -> 62838xxx
    }

    return `${t}@c.us`;
}
function isValidWhatsAppTarget(to) {
    const t = String(to || "").trim();

    if (!t) return false;

    if (t.includes("@g.us")) return true;
    if (t.includes("@c.us")) {
        const numberPart = t.replace("@c.us", "");
        return /^62\d{8,15}$/.test(numberPart);
    }

    const digits = t.replace(/[^\d]/g, "");

    // group id
    if (digits.startsWith("120") && digits.length >= 15) return true;

    // nomor indo yang diterima:
    // 08xxxx, 8xxxx, 62xxxx
    if (digits.startsWith("08")) return digits.length >= 10;
    if (digits.startsWith("8")) return digits.length >= 9;
    if (digits.startsWith("62")) return digits.length >= 10;

    return false;
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

    if (!isValidWhatsAppTarget(to)) {
        return res.status(400).json({
            ok: false,
            message: "Invalid destination format. Use Indonesian number format 08xxxx, 8xxxx, 62xxxx, or valid WhatsApp group id."
        });
    }

    const device = await Device.findByPk(req.deviceId);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });
    if (device.status !== "READY") return res.status(503).json({ ok: false, message: "Device not ready" });

    const toNormalized = normalizeTo(to);

    try {
        const msg = await wa.sendText(req.deviceId, toNormalized, text);

        await Message.create({
            device_id: req.deviceId,
            to: String(toNormalized),
            text: String(text),
            status: "sent",
            error: null,
            message_id: msg?.id?._serialized || null,
        });

        return res.json({
            ok: true,
            deviceId: req.deviceId,
            to: toNormalized,
            messageId: msg?.id?._serialized || null,
        });
    } catch (err) {
        const friendly = mapSendError(err, toNormalized);

        try {
            await Message.create({
                device_id: req.deviceId,
                to: String(toNormalized),
                text: String(text),
                status: "failed",
                error: friendly,
            });
        } catch (dbErr) {
            console.error("[send] Failed to log message to DB:", dbErr.message, dbErr.original?.code, dbErr.original?.sqlMessage);
        }

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