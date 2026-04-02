const fs = require("fs");
const path = require("path");

const COMMAND_PREFIX = process.env.COMMAND_PREFIX || "!";

// Cooldown store: "deviceId:commandName:senderNumber" -> timestamp ms
const cooldownStore = new Map();

class CommandHandler {
    constructor() {
        this.commands = new Map(); // commandName -> module
        this._loadAll();
    }

    _loadAll() {
        const commandsDir = path.join(__dirname, "commands");
        if (!fs.existsSync(commandsDir)) {
            console.warn("[CommandHandler] Folder commands/ tidak ditemukan.");
            return;
        }

        const files = fs
            .readdirSync(commandsDir)
            .filter((f) => f.endsWith(".js") && !f.startsWith("_"));

        for (const file of files) {
            try {
                const mod = require(path.join(commandsDir, file));
                if (!mod.name || typeof mod.execute !== "function") {
                    console.warn(`[CommandHandler] Skip ${file}: missing name/execute`);
                    continue;
                }

                this.commands.set(mod.name.toLowerCase(), mod);

                if (Array.isArray(mod.aliases)) {
                    for (const alias of mod.aliases) {
                        this.commands.set(alias.toLowerCase(), mod);
                    }
                }

                console.log(`[CommandHandler] Loaded: ${COMMAND_PREFIX}${mod.name}`);
            } catch (err) {
                console.error(`[CommandHandler] Failed to load ${file}:`, err.message);
            }
        }
    }

    /**
     * Ambil atau buat CommandConfig dari DB.
     * Lazy-import untuk hindari circular dependency.
     */
    async _getConfig(deviceId, commandName) {
        const { CommandConfig } = require("../db/models");
        const [cfg] = await CommandConfig.findOrCreate({
            where: { device_id: deviceId, command_name: commandName },
            defaults: {
                enabled: true,
                cooldown_seconds: 0,
                whitelist_numbers: [],
                whitelist_groups: [],
            },
        });
        return cfg;
    }

    /**
     * Proses pesan masuk.
     * @param {import("whatsapp-web.js").Message} message
     * @param {import("whatsapp-web.js").Client} client
     * @param {string} deviceId
     */
    async handle(message, client, deviceId) {
        const body = String(message.body || "").trim();
        if (!body.startsWith(COMMAND_PREFIX)) return;

        const withoutPrefix = body.slice(COMMAND_PREFIX.length).trim();
        const parts = withoutPrefix.split(/\s+/);
        const commandName = parts[0].toLowerCase();
        const args = parts.slice(1);

        const command = this.commands.get(commandName);
        if (!command) return;

        const isGroup = message.from.endsWith("@g.us");
        const senderNumber = (message.author || message.from).replace(/@.*/, "");
        const chatId = message.from; // e.g. 120xxx@g.us or 628xxx@c.us

        // ── Scope check ──────────────────────────────────────
        const scope = command.scope || "both";
        if (scope === "group" && !isGroup) {
            return message.reply("❌ Command ini hanya bisa digunakan di grup.");
        }
        if (scope === "private" && isGroup) {
            return message.reply("❌ Command ini hanya bisa digunakan di private chat.");
        }

        // ── Admin check ───────────────────────────────────────
        if (command.adminOnly && isGroup) {
            const chat = await message.getChat();
            const participants = chat.participants || [];
            const senderFull = message.author || message.from;
            const sp = participants.find((p) => p.id._serialized === senderFull);
            if (!sp?.isAdmin && !sp?.isSuperAdmin) {
                return message.reply("❌ Command ini hanya untuk admin grup.");
            }
        }

        // ── DB config ────────────────────────────────────────
        let cfg;
        try {
            cfg = await this._getConfig(deviceId, command.name);
        } catch (err) {
            console.error(`[CommandHandler] DB config error:`, err.message);
            // Jika DB gagal, lanjut tanpa pembatasan
            cfg = null;
        }

        if (cfg) {
            // 1) Enabled check
            if (!cfg.enabled) {
                return message.reply(`⚠️ Command *${COMMAND_PREFIX}${command.name}* sedang dinonaktifkan.`);
            }

            // 2) Whitelist numbers check
            const wlNumbers = cfg.whitelist_numbers;
            if (wlNumbers.length > 0) {
                const allowed = wlNumbers.some(
                    (n) => String(n).replace(/\D/g, "") === senderNumber
                );
                if (!allowed) {
                    return message.reply(`⛔ Kamu tidak memiliki akses ke command ini.`);
                }
            }

            // 3) Whitelist groups check (hanya relevan di grup)
            if (isGroup) {
                const wlGroups = cfg.whitelist_groups;
                if (wlGroups.length > 0) {
                    const allowed = wlGroups.some((g) => g === chatId);
                    if (!allowed) {
                        return message.reply(`⛔ Grup ini tidak memiliki akses ke command ini.`);
                    }
                }
            }

            // 4) Cooldown check
            const cd = Number(cfg.cooldown_seconds) || 0;
            if (cd > 0) {
                const key = `${deviceId}:${command.name}:${senderNumber}`;
                const lastUsed = cooldownStore.get(key) || 0;
                const now = Date.now();
                const elapsed = (now - lastUsed) / 1000;

                if (elapsed < cd) {
                    const remaining = Math.ceil(cd - elapsed);
                    return message.reply(
                        `⏳ Tunggu *${remaining}s* lagi sebelum menggunakan command ini.`
                    );
                }

                cooldownStore.set(key, now);

                // Bersihkan entry lama dari store (TTL sederhana)
                setTimeout(() => cooldownStore.delete(key), cd * 1000 + 5000);
            }
        }

        // ── Eksekusi ─────────────────────────────────────────
        try {
            await command.execute({ message, client, args, isGroup, deviceId });
        } catch (err) {
            console.error(`[CommandHandler] Error executing ${commandName}:`, err.message);
            await message.reply(`⚠️ Terjadi error saat menjalankan *${commandName}*.`);
        }
    }

    getAllCommands() {
        const seen = new Set();
        const result = [];
        for (const cmd of this.commands.values()) {
            if (!seen.has(cmd.name)) {
                seen.add(cmd.name);
                result.push(cmd);
            }
        }
        return result;
    }
}

module.exports = new CommandHandler();