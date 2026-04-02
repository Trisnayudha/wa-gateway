const express = require("express");
const router = express.Router();

const { Device, ApiKey, Message } = require("../db/models");
const requireLogin = require("../middleware/requireLogin");

router.get("/dashboard", requireLogin, async (req, res) => {
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
        attributes: ["id", "name", "status", "last_event"],
    });

    res.render("dashboard", {
        user: req.session.user,
        stats,
        readyDevices,
    });
});

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
    try {
        const messages = await Message.findAll({
            order: [["createdAt", "DESC"]],
            limit: 200
        });
        res.render("messages", { user: req.session.user, messages });
    } catch (err) {
        console.error("[messages] findAll error:", err.message, "\nSQL:", err.sql);
        res.status(500).send("DB error: " + err.message);
    }
});

router.get("/groups", requireLogin, async (req, res) => {
    const devices = await Device.findAll({
        where: { status: "READY" },
        order: [["createdAt", "DESC"]],
        attributes: ["id", "name", "status", "last_event"],
    });

    res.render("groups", {
        user: req.session.user,
        devices,
    });
});

module.exports = router;