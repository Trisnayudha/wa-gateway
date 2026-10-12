const express = require("express");
const router = express.Router();

const { Device, FollowupReminder } = require("../db/models");
const { getSetting, setSetting, REGISTRY } = require("../db/settings");
const followupReminderService = require("../wa/followupReminderService");
const waManager = require("../wa/manager");
const requireLogin = require("../middleware/requireLogin");

router.use(requireLogin);

// Field setting per sumber — key aslinya `${prefix}_${name}` di app_settings (lihat src/db/settings.js)
const FIELDS = ["ENABLED", "API_URL", "DEVICE_ID", "GROUP_ID", "MENTIONS", "QUIET_HOURS"];

const SOURCE_INFO = {
    dmu: {
        title: "IM-DMU — Lead belum di-follow up",
        rule: "Lead baru / submit ulang di DMU yang belum ada follow-up sama sekali. Reminder di jam ke-24, hard warning (tag nomor) di jam ke-48.",
    },
    dmc: {
        title: "DMC — Lead Follow-Up Sponsor",
        rule: "Step Send Sponsor Kit → Follow-up 1 → Follow-up 2 sesuai SLA menu Lead Follow-Up. Reminder ≤24 jam sebelum deadline, hard warning (tag nomor) saat deadline lewat.",
    },
};

function registryDefault(key) {
    return REGISTRY.find((r) => r.key === key)?.defaultValue ?? "";
}

function normalizeGroupId(groupId) {
    const g = String(groupId || "").trim();
    if (!g) return g;
    if (g.endsWith("@g.us")) return g;
    return `${g.replace(/[^\d-]/g, "")}@g.us`;
}

// ─────────────────────────────────────────────────────────
// GET /reminders → status + form per sumber + riwayat terkirim
// ─────────────────────────────────────────────────────────
router.get("/reminders", async (req, res) => {
    try {
        const devices = await Device.findAll({ order: [["name", "ASC"]] });

        const sources = [];
        for (const [key, src] of Object.entries(followupReminderService.SOURCES)) {
            const values = {};
            for (const f of FIELDS) {
                const k = `${src.prefix}_${f}`;
                values[f] = String(await getSetting(k, registryDefault(k)) ?? "");
            }
            const device = devices.find((d) => d.id === values.DEVICE_ID) || null;
            const client = device ? waManager.getClient(device.id) : null;

            sources.push({
                key,
                prefix: src.prefix,
                label: src.label,
                ...SOURCE_INFO[key],
                values,
                apiKeyEnv: src.apiKeyEnv,
                hasApiKey: !!process.env[src.apiKeyEnv],
                deviceReady: !!(client && client.info),
                deviceName: device ? device.name : null,
                lastRun: followupReminderService.getLastRun(key),
                quietNow: followupReminderService.inQuietHours(values.QUIET_HOURS),
            });
        }

        const history = await FollowupReminder.findAll({
            order: [["created_at", "DESC"]],
            limit: 50,
        });

        res.render("reminders", {
            title: "Follow-up Reminders",
            active: "reminders",
            user: req.session.user,
            devices,
            sources,
            history,
            flash: req.session.flash || null,
        });
        delete req.session.flash;
    } catch (err) {
        console.error("[reminders] index error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// POST /reminders/:source → simpan setting satu sumber
// ─────────────────────────────────────────────────────────
router.post("/reminders/:source", async (req, res) => {
    const src = followupReminderService.SOURCES[req.params.source];
    if (!src) return res.status(404).send("Unknown source");

    try {
        const body = req.body || {};
        const values = {
            ENABLED: body.ENABLED === "1" || body.ENABLED === "on" ? "1" : "0",
            API_URL: String(body.API_URL || "").trim(),
            DEVICE_ID: String(body.DEVICE_ID || "").trim(),
            GROUP_ID: normalizeGroupId(body.GROUP_ID),
            MENTIONS: String(body.MENTIONS || "")
                .split(/[\s,;]+/)
                .map((n) => n.replace(/\D/g, ""))
                .filter(Boolean)
                .join(","),
            QUIET_HOURS: String(body.QUIET_HOURS || "").trim(),
        };

        if (values.QUIET_HOURS && !/^\d{1,2}\s*-\s*\d{1,2}$/.test(values.QUIET_HOURS)) {
            throw new Error(`Format jam tenang tidak valid: "${values.QUIET_HOURS}" (contoh: 20-8)`);
        }
        if (values.ENABLED === "1" && (!values.API_URL || !values.DEVICE_ID || !values.GROUP_ID)) {
            throw new Error("Isi API URL, device, dan grup dulu sebelum mengaktifkan reminder.");
        }

        for (const f of FIELDS) {
            const key = `${src.prefix}_${f}`;
            await setSetting(key, values[f], REGISTRY.find((r) => r.key === key)?.description || null);
        }

        req.session.flash = {
            type: "success",
            message: `Reminder ${src.label} disimpan${values.ENABLED === "1" ? " — AKTIF, jalan tiap 15 menit." : " (nonaktif)."}`,
        };
    } catch (err) {
        console.error("[reminders] save error:", err);
        req.session.flash = { type: "danger", message: `Gagal menyimpan ${src.label}: ${err.message}` };
    }
    res.redirect("/reminders");
});

module.exports = router;
