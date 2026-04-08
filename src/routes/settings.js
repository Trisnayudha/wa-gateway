const express = require("express");
const router = express.Router();
const requireLogin = require("../middleware/requireLogin");
const { getAllRegistered, setSetting, REGISTRY } = require("../db/settings");

router.use(requireLogin);

// ─────────────────────────────────────────────────────────
// GET /settings → halaman edit setting
// ─────────────────────────────────────────────────────────
router.get("/settings", async (req, res) => {
    try {
        const settings = await getAllRegistered();
        res.render("settings", {
            title: "App Settings",
            active: "settings",
            user: req.session.user,
            settings,
            flash: req.session.flash || null,
        });
        delete req.session.flash;
    } catch (err) {
        console.error("[settings] index error:", err);
        res.status(500).send("Server error");
    }
});

// ─────────────────────────────────────────────────────────
// POST /settings → simpan semua field sekaligus
// ─────────────────────────────────────────────────────────
router.post("/settings", async (req, res) => {
    try {
        const known = new Set(REGISTRY.map((r) => r.key));
        const updates = [];

        for (const [key, value] of Object.entries(req.body || {})) {
            if (!known.has(key)) continue;
            updates.push(
                setSetting(
                    key,
                    String(value ?? "").trim(),
                    REGISTRY.find((r) => r.key === key)?.description || null
                )
            );
        }

        await Promise.all(updates);

        req.session.flash = { type: "success", message: "Settings berhasil disimpan." };
    } catch (err) {
        console.error("[settings] save error:", err);
        req.session.flash = { type: "danger", message: `Gagal menyimpan: ${err.message}` };
    }
    res.redirect("/settings");
});

module.exports = router;
