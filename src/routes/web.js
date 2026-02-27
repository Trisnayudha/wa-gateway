const express = require("express");
const router = express.Router();

const { Device, ApiKey, Message } = require("../db/models"); // sesuaikan path model kamu
const requireLogin = require("../middleware/requireLogin");

router.get("/dashboard", requireLogin, async (req, res) => {
    // stats kamu (kalau udah ada, pakai punyamu)
    const totalDevices = await Device.count();
    const readyDevicesCt = await Device.count({ where: { status: "READY" } });
    const totalKeys = await ApiKey.count();
    const totalMessages = await Message.count();

    const stats = {
        totalDevices,
        readyDevices: readyDevicesCt,
        totalKeys,
        totalMessages,
    };

    const readyDevices = await Device.findAll({
        where: { status: "READY" },
        order: [["createdAt", "DESC"]],
        attributes: ["id", "name", "status", "last_event"], // sesuaikan kolommu
    });

    res.render("dashboard", {
        user: req.session.user,
        stats,
        readyDevices, // ✅ ini yang bikin EJS nggak error
    });
});

module.exports = router;

router.get("/devices", requireLogin, async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    res.render("devices", { user: req.session.user, devices });
});

router.get("/api-keys", requireLogin, async (req, res) => {
    const devices = await Device.findAll({ order: [["createdAt", "DESC"]] });
    const keys = await ApiKey.findAll({ order: [["created_at", "DESC"]] });

    res.render("api-keys", { user: req.session.user, devices, keys });
});

router.get("/messages", requireLogin, async (req, res) => {
    const messages = await Message.findAll({ order: [["createdAt", "DESC"]], limit: 200 });
    res.render("messages", { user: req.session.user, messages });
});

module.exports = router;