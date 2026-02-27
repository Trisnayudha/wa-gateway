const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { Device, ApiKey } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

function genKey() {
    return "wg_" + crypto.randomBytes(24).toString("hex");
}

/**
 * DEVICES
 */

// GET /api/admin/devices
router.get("/devices", async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    res.json({ ok: true, devices });
});

// POST /api/admin/devices { name }
router.post("/devices", async (req, res) => {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ ok: false, message: "name required" });
    }

    const device = await Device.create({ name: String(name).trim() });

    // ensure WA client exists (generate QR later when needed)
    wa.ensureClient(device.id);

    res.json({ ok: true, device });
});

// PATCH /api/admin/devices/:id  { name }
router.patch("/devices/:id", async (req, res) => {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
        return res.status(400).json({ ok: false, message: "name required" });
    }

    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    device.name = String(name).trim();
    await device.save();

    res.json({ ok: true, device });
});

// POST /api/admin/devices/:id/restart
router.post("/devices/:id/restart", async (req, res) => {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    await wa.restart(req.params.id);

    res.json({
        ok: true,
        message: "Restarting device. If disconnected, scan QR again.",
    });
});

// GET /api/admin/devices/status (polling)
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
            message: "QR not available (maybe already connected or not generated yet). Try restart then open QR again.",
        });
    }
    res.json({ ok: true, qr });
});

/**
 * API KEYS
 * - disimpan HASH only (key_hash)
 * - raw key hanya muncul sekali di response create
 */

// GET /api/admin/devices/:id/api-keys
router.get("/devices/:id/api-keys", async (req, res) => {
    const device_id = req.params.id;

    const device = await Device.findByPk(device_id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    const keys = await ApiKey.findAll({
        where: { device_id },
        order: [["created_at", "DESC"]],
    });

    // jangan pernah balikin raw key
    res.json({
        ok: true,
        keys: keys.map((k) => ({
            id: k.id,
            device_id: k.device_id,
            label: k.label,
            is_active: !!k.is_active,
            created_at: k.created_at,
            updated_at: k.updated_at,
        })),
    });
});

// POST /api/admin/devices/:id/api-keys { label }
router.post("/devices/:id/api-keys", async (req, res) => {
    const device_id = req.params.id;
    const { label } = req.body || {};
    if (!label || !String(label).trim()) {
        return res.status(400).json({ ok: false, message: "label required" });
    }

    const device = await Device.findByPk(device_id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    // optional: non-aktifkan key sebelumnya biar cuma 1 aktif
    await ApiKey.update(
        { is_active: false },
        { where: { device_id, is_active: true } }
    );

    const plain = genKey(); // show ONCE
    const hash = await bcrypt.hash(plain, 10);

    const created = await ApiKey.create({
        device_id,
        label: String(label).trim(),
        key_hash: hash,
        api_key_plain: plain,   // 🔥 tambahkan ini
        is_active: true,
    });

    // ✅ raw key hanya muncul sekali di sini
    res.json({ ok: true, apiKeyId: created.id, apiKey: plain });
});

// PATCH /api/admin/api-keys/:id { is_active }
router.patch("/api-keys/:id", async (req, res) => {
    const { is_active } = req.body || {};
    const k = await ApiKey.findByPk(req.params.id);
    if (!k) return res.status(404).json({ ok: false, message: "API key not found" });

    // jika activate -> nonaktifkan semua key lain di device
    if (is_active === true || is_active === 1) {
        await ApiKey.update(
            { is_active: false },
            { where: { device_id: k.device_id } }
        );
        k.is_active = true;
    } else {
        k.is_active = false;
    }

    await k.save();
    res.json({ ok: true, key: { id: k.id, device_id: k.device_id, label: k.label, is_active: !!k.is_active } });
});

// GET /api/admin/api-keys  (list)
router.get("/api-keys", async (req, res) => {
    const keys = await ApiKey.findAll({ order: [["created_at", "DESC"]] });
    res.json({ ok: true, keys });
});

// GET /api/admin/devices  (already exist) -> dipakai dropdown create key
// POST /api/admin/devices/:id/api-keys (already exist) -> create

// PATCH /api/admin/api-keys/:id  { is_active: true/false }
router.patch("/api-keys/:id", async (req, res) => {
    const { is_active } = req.body || {};
    const k = await ApiKey.findByPk(req.params.id);
    if (!k) return res.status(404).json({ ok: false, message: "API key not found" });

    // kalau activate -> nonaktifkan semua key lain untuk device yg sama
    if (is_active === true || is_active === 1) {
        await ApiKey.update({ is_active: false }, { where: { device_id: k.device_id } });
        k.is_active = true;
    } else {
        k.is_active = false;
    }

    await k.save();
    res.json({ ok: true });
});

// DELETE /api/admin/api-keys/:id
router.delete("/api-keys/:id", async (req, res) => {
    const k = await ApiKey.findByPk(req.params.id);
    if (!k) return res.status(404).json({ ok: false, message: "API key not found" });

    await k.destroy();
    res.json({ ok: true });
});

module.exports = router;