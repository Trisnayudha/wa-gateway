const express = require("express");
const authApiKey = require("../middleware/auth");

const { Device, Message } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

function normalizeTo(to) {
    let t = String(to || "").trim();

    if (!t) return t;

    if (t.includes("@c.us") || t.includes("@g.us")) return t;

    t = t.replace(/[^\d]/g, "");

    const looksLikeGroup = t.startsWith("120") && t.length >= 15;
    if (looksLikeGroup) return `${t}@g.us`;

    if (t.startsWith("08")) {
        t = "62" + t.slice(1);
    } else if (t.startsWith("8")) {
        t = "62" + t;
    } else if (t.startsWith("620")) {
        t = "62" + t.slice(3);
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

    if (digits.startsWith("120") && digits.length >= 15) return true;

    if (digits.startsWith("08")) return digits.length >= 10;
    if (digits.startsWith("8")) return digits.length >= 9;
    if (digits.startsWith("62")) return digits.length >= 10;

    return false;
}

function mapSendError(err, toNormalized) {
    const msg = String(err?.message || err || "").trim();

    const isGroup = String(toNormalized || "").includes("@g.us");

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

function isValidHttpUrl(url) {
    try {
        const u = new URL(String(url || "").trim());
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

router.post("/send", authApiKey, async (req, res) => {
    const { to, text, attachmentUrl, attachmentCaption, attachmentFilename } = req.body || {};

    if (!to) {
        return res.status(400).json({ ok: false, message: "body required: {to, text? , attachmentUrl?}" });
    }

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasAttachment = typeof attachmentUrl === "string" && attachmentUrl.trim().length > 0;

    if (!hasText && !hasAttachment) {
        return res.status(400).json({
            ok: false,
            message: "Either text or attachmentUrl must be provided"
        });
    }

    if (hasAttachment && !isValidHttpUrl(attachmentUrl)) {
        return res.status(400).json({
            ok: false,
            message: "Invalid attachmentUrl. Use a valid http/https URL"
        });
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
        const payloadText = hasText ? text.trim() : null;

        const msg = hasAttachment
            ? await wa.sendAttachment(req.deviceId, toNormalized, {
                url: attachmentUrl,
                caption: typeof attachmentCaption === "string" && attachmentCaption.trim()
                    ? attachmentCaption.trim()
                    : payloadText,
                filename: typeof attachmentFilename === "string" && attachmentFilename.trim()
                    ? attachmentFilename.trim()
                    : undefined,
            })
            : await wa.sendText(req.deviceId, toNormalized, payloadText);

        await Message.create({
            device_id: req.deviceId,
            to: String(toNormalized),
            text: String(payloadText || (hasAttachment ? `[attachment] ${attachmentUrl}` : "")),
            status: "sent",
            error: null,
            message_id: msg?.id?._serialized || null,
        });

        return res.json({
            ok: true,
            deviceId: req.deviceId,
            to: toNormalized,
            messageId: msg?.id?._serialized || null,
            hasAttachment,
        });
    } catch (err) {
        const friendly = mapSendError(err, toNormalized);

        try {
            await Message.create({
                device_id: req.deviceId,
                to: String(toNormalized),
                text: String((typeof text === "string" ? text : "") || (hasAttachment ? `[attachment] ${attachmentUrl}` : "")),
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
            friendly.toLowerCase().includes("not allowed") ||
            friendly.toLowerCase().includes("invalid attachmenturl");

        return res.status(isClientError ? 400 : 500).json({
            ok: false,
            to: toNormalized,
            message: friendly,
        });
    }
});

router.get("/groups", authApiKey, async (req, res) => {
    try {
        const client = wa.getClient(req.deviceId);
        if (!client) return res.status(503).json({ ok: false, message: "Client not ready" });

        const chats = await client.getChats();
        const groups = chats
            .filter((c) => c.isGroup)
            .map((g) => ({
                name: g.name,
                id: g.id?._serialized,
                participants: g.participants?.length ?? null,
            }));

        return res.json({ ok: true, deviceId: req.deviceId, groups });
    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message || "Failed to fetch groups" });
    }
});

module.exports = router;
