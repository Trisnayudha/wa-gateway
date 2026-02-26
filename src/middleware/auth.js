const bcrypt = require("bcrypt");
const { ApiKey } = require("../db/models");

async function authApiKey(req, res, next) {
    try {
        const key = req.header("X-API-KEY");
        if (!key) return res.status(401).json({ ok: false, message: "Missing X-API-KEY" });

        const keys = await ApiKey.findAll({ where: { is_active: true } });

        for (const k of keys) {
            const match = await bcrypt.compare(key, k.key_hash);
            if (match) {
                req.deviceId = k.device_id;
                req.apiKeyId = k.id;
                return next();
            }
        }

        return res.status(401).json({ ok: false, message: "Invalid API key" });
    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
}

module.exports = authApiKey;