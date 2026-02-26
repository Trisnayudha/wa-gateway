const express = require("express");
const authApiKey = require("../middleware/auth");

const { Device, Message } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

// POST /api/send  (Header: X-API-KEY)
// Body: { to, text }
router.post("/send", authApiKey, async (req, res) => {
    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ ok: false, message: "body required: {to, text}" });

    const device = await Device.findByPk(req.deviceId);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });
    if (device.status !== "READY") return res.status(503).json({ ok: false, message: "Device not ready" });

    try {
        const msg = await wa.sendText(req.deviceId, to, text);

        await Message.create({
            device_id: req.deviceId,
            to_number: String(to),
            text: String(text),
            status: "SENT",
            error: null,
        });

        res.json({ ok: true, deviceId: req.deviceId, messageId: msg?.id?._serialized || null });
    } catch (err) {
        await Message.create({
            device_id: req.deviceId,
            to_number: String(to),
            text: String(text),
            status: "FAILED",
            error: err.message || "Send failed",
        });

        res.status(500).json({ ok: false, message: err.message || "Send failed" });
    }
});

module.exports = router;