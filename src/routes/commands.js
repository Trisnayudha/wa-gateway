const express = require("express");
const router = express.Router();
const { CommandConfig, Device } = require("../db/models");
const commandHandler = require("../wa/commandHandler");
const requireLogin = require("../middleware/requireLogin");

// Semua route butuh login
router.use(requireLogin);

// ─────────────────────────────────────────────────────────
// GET /commands
// List semua device + jumlah command config-nya
// ─────────────────────────────────────────────────────────
router.get("/commands", async (req, res) => {
    try {
        const devices = await Device.findAll({ order: [["id", "ASC"]] });

        // Hitung jumlah config per device
        const counts = await CommandConfig.findAll({
            attributes: [
                "device_id",
                [require("sequelize").fn("COUNT", require("sequelize").col("id")), "count"],
            ],
            group: ["device_id"],
        });

        const countMap = {};
        counts.forEach((c) => {
            countMap[c.device_id] = Number(c.get("count"));
        });

        res.render("commands/index", {
            title: "Command Manager",
            active: "commands",
            user: req.session.user,
            devices,
            countMap,
            flash: req.session.flash || null,
        });

        delete req.session.flash;
    } catch (err) {
        console.error("[commands] index error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// GET /commands/:deviceId
// List semua command untuk device tertentu
// ─────────────────────────────────────────────────────────
router.get("/commands/:deviceId", async (req, res) => {
    const { deviceId } = req.params;

    try {
        const device = await Device.findByPk(deviceId);
        if (!device) return res.status(404).send("Device not found");

        // Semua command yang diketahui handler
        const allCommands = commandHandler.getAllCommands();

        // Ambil semua config yang sudah ada di DB
        const existingConfigs = await CommandConfig.findAll({
            where: { device_id: deviceId },
        });

        const configMap = {};
        existingConfigs.forEach((c) => {
            configMap[c.command_name] = c;
        });

        // Gabungkan: command dari handler + config dari DB
        const rows = allCommands.map((cmd) => {
            const cfg = configMap[cmd.name];
            return {
                name: cmd.name,
                description: cmd.description || "-",
                scope: cmd.scope || "both",
                adminOnly: cmd.adminOnly || false,
                enabled: cfg ? cfg.enabled : true,
                cooldown_seconds: cfg ? cfg.cooldown_seconds : 0,
                whitelist_numbers: cfg ? cfg.whitelist_numbers : [],
                whitelist_groups: cfg ? cfg.whitelist_groups : [],
                hasConfig: !!cfg,
                configId: cfg ? cfg.id : null,
            };
        });

        res.render("commands/device", {
            title: `Commands — ${device.name || deviceId}`,
            active: "commands",
            user: req.session.user,
            device,
            rows,
            flash: req.session.flash || null,
        });

        delete req.session.flash;
    } catch (err) {
        console.error("[commands] device error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// GET /commands/:deviceId/:commandName/edit
// Form edit config
// ─────────────────────────────────────────────────────────
router.get("/commands/:deviceId/:commandName/edit", async (req, res) => {
    const { deviceId, commandName } = req.params;

    try {
        const device = await Device.findByPk(deviceId);
        if (!device) return res.status(404).send("Device not found");

        const allCommands = commandHandler.getAllCommands();
        const cmdMeta = allCommands.find((c) => c.name === commandName);
        if (!cmdMeta) return res.status(404).send("Command not found");

        const [cfg] = await CommandConfig.findOrCreate({
            where: { device_id: deviceId, command_name: commandName },
            defaults: {
                enabled: true,
                cooldown_seconds: 0,
                whitelist_numbers: [],
                whitelist_groups: [],
            },
        });

        res.render("commands/edit", {
            title: `Edit — !${commandName}`,
            active: "commands",
            user: req.session.user,
            device,
            cmdMeta,
            cfg,
            flash: req.session.flash || null,
        });

        delete req.session.flash;
    } catch (err) {
        console.error("[commands] edit GET error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// POST /commands/:deviceId/:commandName/edit
// Simpan config
// ─────────────────────────────────────────────────────────
router.post("/commands/:deviceId/:commandName/edit", async (req, res) => {
    const { deviceId, commandName } = req.params;

    try {
        const {
            enabled,
            cooldown_seconds,
            whitelist_numbers_raw,
            whitelist_groups_raw,
        } = req.body;

        // Parse whitelist (newline-separated)
        const parseList = (raw) =>
            String(raw || "")
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);

        const wlNumbers = parseList(whitelist_numbers_raw);
        const wlGroups = parseList(whitelist_groups_raw);

        await CommandConfig.upsert({
            device_id: deviceId,
            command_name: commandName,
            enabled: enabled === "1" || enabled === "on" || enabled === true,
            cooldown_seconds: Math.max(0, parseInt(cooldown_seconds) || 0),
            whitelist_numbers: wlNumbers,
            whitelist_groups: wlGroups,
        });

        req.session.flash = { type: "success", message: `Config !${commandName} berhasil disimpan.` };
        res.redirect(`/commands/${encodeURIComponent(deviceId)}`);
    } catch (err) {
        console.error("[commands] edit POST error:", err);
        req.session.flash = { type: "danger", message: `Gagal menyimpan: ${err.message}` };
        res.redirect(`/commands/${encodeURIComponent(deviceId)}/${commandName}/edit`);
    }
});

// ─────────────────────────────────────────────────────────
// POST /commands/:deviceId/:commandName/toggle
// Toggle enabled/disabled (AJAX-friendly)
// ─────────────────────────────────────────────────────────
router.post("/commands/:deviceId/:commandName/toggle", async (req, res) => {
    const { deviceId, commandName } = req.params;

    try {
        const [cfg] = await CommandConfig.findOrCreate({
            where: { device_id: deviceId, command_name: commandName },
            defaults: {
                enabled: true,
                cooldown_seconds: 0,
                whitelist_numbers: [],
                whitelist_groups: [],
            },
        });

        cfg.enabled = !cfg.enabled;
        await cfg.save();

        res.json({ ok: true, enabled: cfg.enabled });
    } catch (err) {
        console.error("[commands] toggle error:", err);
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────
// POST /commands/:deviceId/reset-all
// Reset semua config device ke default
// ─────────────────────────────────────────────────────────
router.post("/commands/:deviceId/reset-all", async (req, res) => {
    const { deviceId } = req.params;

    try {
        await CommandConfig.destroy({ where: { device_id: deviceId } });
        req.session.flash = { type: "success", message: "Semua config berhasil direset ke default." };
    } catch (err) {
        req.session.flash = { type: "danger", message: `Gagal reset: ${err.message}` };
    }

    res.redirect(`/commands/${encodeURIComponent(deviceId)}`);
});

module.exports = router;