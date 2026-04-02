const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { Device, ApiKey } = require("../db/models");
const wa = require("../wa/manager");

const router = express.Router();

function genKey() {
    return "wg_" + crypto.randomBytes(24).toString("hex");
}

function normalizeGroupId(groupId) {
    let g = String(groupId || "").trim();
    if (!g) return g;

    if (g.endsWith("@g.us")) return g;
    return `${g}@g.us`;
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

// DELETE /api/admin/devices/:id
router.delete("/devices/:id", async (req, res) => {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    if (device.status !== "DISCONNECTED") {
        return res.status(400).json({ ok: false, message: "Hanya device DISCONNECTED yang bisa dihapus." });
    }

    await device.destroy();
    res.json({ ok: true });
});

// POST /api/admin/devices/:id/restart
router.post("/devices/:id/restart", async (req, res) => {
    const device = await Device.findByPk(req.params.id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    await wa.restart(req.params.id);
    res.json({ ok: true, message: "Restarting device. If disconnected, scan QR again." });
});

// GET /api/admin/devices/status
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
 */

// GET /api/admin/devices/:id/api-keys
router.get("/devices/:id/api-keys", async (req, res) => {
    const device_id = req.params.id;

    const device = await Device.findByPk(device_id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    const keys = await ApiKey.findAll({ where: { device_id }, order: [["created_at", "DESC"]] });

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
    const { label, phone_number } = req.body || {};
    if (!label || !String(label).trim()) {
        return res.status(400).json({ ok: false, message: "label required" });
    }

    const device = await Device.findByPk(device_id);
    if (!device) return res.status(404).json({ ok: false, message: "Device not found" });

    await ApiKey.update({ is_active: false }, { where: { device_id, is_active: true } });

    const plain = genKey();
    const hash = await bcrypt.hash(plain, 10);

    const created = await ApiKey.create({
        device_id,
        label: String(label).trim(),
        key_hash: hash,
        api_key_plain: plain,
        phone_number: phone_number ? String(phone_number).trim() : null,
        is_active: true,
    });

    res.json({ ok: true, apiKeyId: created.id, apiKey: plain });
});

// GET /api/admin/devices/:id/active-api-key  (buat auto-fill dashboard)
router.get("/devices/:id/active-api-key", async (req, res) => {
    const device_id = req.params.id;

    const k = await ApiKey.findOne({
        where: { device_id, is_active: true },
        order: [["created_at", "DESC"]],
    });

    if (!k) {
        return res.status(404).json({ ok: false, message: "No active API key. Create one first." });
    }

    res.json({ ok: true, apiKeyId: k.id, apiKey: k.api_key_plain || null });
});

// PATCH /api/admin/api-keys/:id { is_active }
router.patch("/api-keys/:id", async (req, res) => {
    const { is_active } = req.body || {};
    const k = await ApiKey.findByPk(req.params.id);
    if (!k) return res.status(404).json({ ok: false, message: "API key not found" });

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

/**
 * GROUPS
 */

// GET /api/admin/devices/:id/groups
router.get("/devices/:id/groups", async (req, res) => {
    try {
        const device = await Device.findByPk(req.params.id);
        if (!device) {
            return res.status(404).json({ ok: false, message: "Device not found" });
        }

        if (device.status !== "READY") {
            return res.status(503).json({ ok: false, message: "Device not ready" });
        }

        const client = wa.getClient(req.params.id);
        if (!client) {
            return res.status(503).json({ ok: false, message: "Client not ready" });
        }

        const chats = await client.getChats();

        const groups = chats
            .filter((c) => c.isGroup)
            .map((g) => ({
                name: g.name,
                id: g.id?._serialized || null,
                participants: g.participants?.length ?? null,
            }))
            .filter((g) => !!g.id)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

        return res.json({
            ok: true,
            deviceId: req.params.id,
            total: groups.length,
            groups,
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            message: err.message || "Failed to fetch groups",
        });
    }
});

// GET /api/admin/devices/:id/groups/check?groupId=120363xxxx
router.get("/devices/:id/groups/check", async (req, res) => {
    try {
        const { groupId } = req.query || {};
        if (!groupId) {
            return res.status(400).json({
                ok: false,
                message: "query required: groupId",
            });
        }

        const device = await Device.findByPk(req.params.id);
        if (!device) {
            return res.status(404).json({ ok: false, message: "Device not found" });
        }

        if (device.status !== "READY") {
            return res.status(503).json({ ok: false, message: "Device not ready" });
        }

        const client = wa.getClient(req.params.id);
        if (!client) {
            return res.status(503).json({ ok: false, message: "Client not ready" });
        }

        const gid = normalizeGroupId(groupId);

        const chats = await client.getChats();
        const grp = chats.find((c) => c.isGroup && c.id?._serialized === gid);

        if (!grp) {
            return res.status(404).json({
                ok: false,
                deviceId: req.params.id,
                groupId: gid,
                message: "Group not found on this device",
            });
        }

        return res.json({
            ok: true,
            deviceId: req.params.id,
            groupId: gid,
            name: grp.name,
            participants: grp.participants?.length ?? null,
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            message: err.message || "Failed to check group",
        });
    }
});

module.exports = router;