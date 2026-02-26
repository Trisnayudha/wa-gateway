const express = require("express");
const requireLogin = require("../middleware/requireLogin");

const { Device, ApiKey, Message } = require("../db/models");

const router = express.Router();

router.get("/", (req, res) => res.redirect("/dashboard"));

router.get("/dashboard", requireLogin, async (req, res) => {
    const totalDevices = await Device.count();
    const readyDevices = await Device.count({ where: { status: "READY" } });
    const totalKeys = await ApiKey.count();
    const totalMessages = await Message.count();

    res.render("dashboard", {
        user: req.session.user,
        stats: { totalDevices, readyDevices, totalKeys, totalMessages },
    });
});

router.get("/devices", requireLogin, async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    res.render("devices", { user: req.session.user, devices });
});

router.get("/api-keys", requireLogin, async (req, res) => {
    const keys = await ApiKey.findAll({ order: [["createdAt", "DESC"]] });
    res.render("api-keys", { user: req.session.user, keys });
});

router.get("/messages", requireLogin, async (req, res) => {
    const messages = await Message.findAll({ order: [["createdAt", "DESC"]], limit: 200 });
    res.render("messages", { user: req.session.user, messages });
});

module.exports = router;