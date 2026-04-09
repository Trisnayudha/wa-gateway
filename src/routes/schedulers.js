const express = require("express");
const router = express.Router();
const cron = require("node-cron");

const { EventScheduler, Device } = require("../db/models");
const schedulerService = require("../wa/schedulerService");
const waManager = require("../wa/manager");
const requireLogin = require("../middleware/requireLogin");

router.use(requireLogin);

const DEFAULT_API_URLS = {
    checkin:      "https://membership.djakarta-miningclub.com/api/summary-attandance",
    registration: "https://membership.djakarta-miningclub.com/api/registration-report",
};

// ─────────────────────────────────────────────────────────
// GET /schedulers → list semua scheduler
// ─────────────────────────────────────────────────────────
router.get("/schedulers", async (req, res) => {
    try {
        const schedulers = await EventScheduler.findAll({
            order: [["created_at", "DESC"]],
        });
        const devices = await Device.findAll({ order: [["id", "ASC"]] });

        const runningIds = new Set(schedulerService.runningIds());

        res.render("schedulers/index", {
            title: "Event Schedulers",
            active: "schedulers",
            user: req.session.user,
            schedulers,
            devices,
            runningIds,
            flash: req.session.flash || null,
        });
        delete req.session.flash;
    } catch (err) {
        console.error("[schedulers] index error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// GET /schedulers/new → form buat scheduler baru
// ─────────────────────────────────────────────────────────
router.get("/schedulers/new", async (req, res) => {
    try {
        const devices = await Device.findAll({ order: [["id", "ASC"]] });
        res.render("schedulers/form", {
            title: "Buat Scheduler Baru",
            active: "schedulers",
            user: req.session.user,
            devices,
            scheduler: null,
            defaultApiUrls: DEFAULT_API_URLS,
            flash: req.session.flash || null,
        });
        delete req.session.flash;
    } catch (err) {
        console.error("[schedulers] new GET error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// POST /schedulers → simpan scheduler baru
// ─────────────────────────────────────────────────────────
router.post("/schedulers", async (req, res) => {
    try {
        const { name, device_id, event_id, group_id, cron_expression, timezone, api_url, scheduler_type, is_active } = req.body;

        if (!cron.validate(cron_expression)) {
            req.session.flash = { type: "danger", message: `Cron expression tidak valid: "${cron_expression}"` };
            return res.redirect("/schedulers/new");
        }

        const s = await EventScheduler.create({
            name: String(name).trim(),
            device_id,
            event_id: String(event_id).trim(),
            group_id: normalizeGroupId(group_id),
            cron_expression: String(cron_expression).trim(),
            timezone: String(timezone || "Asia/Jakarta").trim(),
            api_url: String(api_url || DEFAULT_API_URLS[scheduler_type === "registration" ? "registration" : "checkin"]).trim(),
            scheduler_type: scheduler_type === "registration" ? "registration" : "checkin",
            is_active: is_active === "1" || is_active === "on",
        });

        await schedulerService.reload(s.id, waManager);

        req.session.flash = { type: "success", message: `Scheduler "${s.name}" berhasil dibuat.` };
        res.redirect("/schedulers");
    } catch (err) {
        console.error("[schedulers] create error:", err);
        req.session.flash = { type: "danger", message: `Gagal membuat scheduler: ${err.message}` };
        res.redirect("/schedulers/new");
    }
});

// ─────────────────────────────────────────────────────────
// GET /schedulers/:id/edit → form edit
// ─────────────────────────────────────────────────────────
router.get("/schedulers/:id/edit", async (req, res) => {
    try {
        const scheduler = await EventScheduler.findByPk(req.params.id);
        if (!scheduler) return res.status(404).send("Scheduler not found");

        const devices = await Device.findAll({ order: [["id", "ASC"]] });

        res.render("schedulers/form", {
            title: `Edit — ${scheduler.name}`,
            active: "schedulers",
            user: req.session.user,
            devices,
            scheduler,
            defaultApiUrls: DEFAULT_API_URLS,
            flash: req.session.flash || null,
        });
        delete req.session.flash;
    } catch (err) {
        console.error("[schedulers] edit GET error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// POST /schedulers/:id/edit → update
// ─────────────────────────────────────────────────────────
router.post("/schedulers/:id/edit", async (req, res) => {
    try {
        const scheduler = await EventScheduler.findByPk(req.params.id);
        if (!scheduler) return res.status(404).send("Scheduler not found");

        const { name, device_id, event_id, group_id, cron_expression, timezone, api_url, scheduler_type, is_active } = req.body;

        if (!cron.validate(cron_expression)) {
            req.session.flash = { type: "danger", message: `Cron expression tidak valid: "${cron_expression}"` };
            return res.redirect(`/schedulers/${req.params.id}/edit`);
        }

        await scheduler.update({
            name: String(name).trim(),
            device_id,
            event_id: String(event_id).trim(),
            group_id: normalizeGroupId(group_id),
            cron_expression: String(cron_expression).trim(),
            timezone: String(timezone || "Asia/Jakarta").trim(),
            api_url: String(api_url || DEFAULT_API_URLS[scheduler_type === "registration" ? "registration" : "checkin"]).trim(),
            scheduler_type: scheduler_type === "registration" ? "registration" : "checkin",
            is_active: is_active === "1" || is_active === "on",
        });

        await schedulerService.reload(scheduler.id, waManager);

        req.session.flash = { type: "success", message: `Scheduler "${scheduler.name}" berhasil diupdate.` };
        res.redirect("/schedulers");
    } catch (err) {
        console.error("[schedulers] edit POST error:", err);
        req.session.flash = { type: "danger", message: `Gagal update: ${err.message}` };
        res.redirect(`/schedulers/${req.params.id}/edit`);
    }
});

// ─────────────────────────────────────────────────────────
// POST /schedulers/:id/toggle → toggle is_active
// ─────────────────────────────────────────────────────────
router.post("/schedulers/:id/toggle", async (req, res) => {
    try {
        const scheduler = await EventScheduler.findByPk(req.params.id);
        if (!scheduler) return res.status(404).json({ ok: false, message: "Not found" });

        scheduler.is_active = !scheduler.is_active;
        await scheduler.save();

        await schedulerService.reload(scheduler.id, waManager);

        res.json({ ok: true, is_active: scheduler.is_active });
    } catch (err) {
        console.error("[schedulers] toggle error:", err);
        res.status(500).json({ ok: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────
// POST /schedulers/:id/delete → hapus
// ─────────────────────────────────────────────────────────
router.post("/schedulers/:id/delete", async (req, res) => {
    try {
        const scheduler = await EventScheduler.findByPk(req.params.id);
        if (!scheduler) {
            req.session.flash = { type: "danger", message: "Scheduler tidak ditemukan." };
            return res.redirect("/schedulers");
        }

        schedulerService.stop(scheduler.id);
        await scheduler.destroy();

        req.session.flash = { type: "success", message: `Scheduler "${scheduler.name}" berhasil dihapus.` };
        res.redirect("/schedulers");
    } catch (err) {
        console.error("[schedulers] delete error:", err);
        req.session.flash = { type: "danger", message: `Gagal menghapus: ${err.message}` };
        res.redirect("/schedulers");
    }
});

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function normalizeGroupId(groupId) {
    const g = String(groupId || "").trim();
    if (!g) return g;
    if (g.endsWith("@g.us")) return g;
    return `${g.replace(/\D/g, "")}@g.us`;
}

module.exports = router;
