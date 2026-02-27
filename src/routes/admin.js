const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { Device, ApiKey } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

// GET /api/admin/devices
router.get("/devices", async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    res.json({ ok: true, devices });
});

// POST /api/admin/devices { name }
router.post("/devices", async (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, message: "name required" });

    const device = await Device.create({ name });
    wa.ensureClient(device.id);

    res.json({ ok: true, device });
});

// Tambahkan di src/routes/admin.js

// PATCH /api/admin/devices/:id  { name }
router.patch("/devices/:id", async (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, message: "name required" });

    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    device.name = name;
    await device.save();

    res.json({ ok: true, device });
});

// POST /api/admin/devices/:id/restart
router.post("/devices/:id/restart", async (req, res) => {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    await wa.restart(req.params.id);
    res.json({ ok: true, message: "Restarting device. Please scan QR again if needed." });
});

// GET /api/admin/devices/status (for polling)
router.get("/devices/status", async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    res.json({ ok: true, devices });
});

// GET /api/admin/devices/:id/qr
router.get("/devices/:id/qr", async (req, res) => {
    const qr = wa.getQr(req.params.id);
    if (!qr) {
        return res.status(404).json({
            ok: false,
            message: "QR not available (maybe already connected or not generated yet)",
        });
    }
    res.json({ ok: true, qr });
});

// POST /api/admin/devices/:id/api-keys { label }
router.post("/devices/:id/api-keys", async (req, res) => {
    const { label } = req.body || {};
    if (!label) return res.status(400).json({ ok: false, message: "label required" });

    const plain = `wg_${crypto.randomBytes(24).toString("hex")}`; // show ONCE
    const hash = await bcrypt.hash(plain, 10);

    const created = await ApiKey.create({
        device_id: req.params.id,
        label,
        key_hash: hash,
        is_active: true,
    });

    res.json({ ok: true, apiKeyId: created.id, apiKey: plain });
});

module.exports = router;