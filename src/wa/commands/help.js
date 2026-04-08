const PREFIX = process.env.COMMAND_PREFIX || "!";

/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "help",
    aliases: ["menu", "h"],
    description: "Tampilkan daftar semua command",
    usage: "!help [command]",
    scope: "both",

    async execute({ message, args }) {
        // Lazy require to avoid circular dependency with commandHandler
        const handler = require("../commandHandler");
        const commands = handler.getAllCommands();

        // !help <command> -> detail satu command
        if (args.length > 0) {
            const target = args[0].toLowerCase().replace(/^!/, "");
            const cmd = commands.find((c) => c.name === target || (c.aliases || []).includes(target));

            if (!cmd) {
                return message.reply(`❌ Command *${PREFIX}${target}* tidak ditemukan.`);
            }

            const aliases = cmd.aliases?.length ? cmd.aliases.map((a) => `${PREFIX}${a}`).join(", ") : "-";
            const scopeLabel = { group: "Grup saja", private: "Private saja", both: "Grup & Private" }[cmd.scope || "both"];

            return message.reply(
                `📖 *Detail Command*\n\n` +
                `• Nama    : ${PREFIX}${cmd.name}\n` +
                `• Alias   : ${aliases}\n` +
                `• Scope   : ${scopeLabel}\n` +
                `• Admin   : ${cmd.adminOnly ? "Ya" : "Tidak"}\n` +
                `• Usage   : ${cmd.usage || PREFIX + cmd.name}\n\n` +
                `📝 ${cmd.description}`
            );
        }

        // Grupkan berdasarkan scope
        const groupCmds = commands.filter((c) => c.scope === "group" || c.scope === "both");
        const privateCmds = commands.filter((c) => c.scope === "private");
        const bothCmds = commands.filter((c) => !c.scope || c.scope === "both");

        const formatCmd = (c) =>
            `  • *${PREFIX}${c.name}* — ${c.description}${c.adminOnly ? " 👑" : ""}`;

        let text = `🤖 *Daftar Command Bot*\n`;
        text += `Prefix: *${PREFIX}*  |  👑 = Admin Only\n`;
        text += `\n━━━━━━━━━━━━━━━━━━\n`;

        const groupOnly = commands.filter((c) => c.scope === "group");
        const privateOnly = commands.filter((c) => c.scope === "private");
        const allScope = commands.filter((c) => !c.scope || c.scope === "both");

        if (allScope.length > 0) {
            text += `\n📌 *Umum (Grup & Private)*`;

            // Grup berdasarkan category. Yang tanpa category masuk ke "Umum".
            const byCategory = {};
            for (const c of allScope) {
                const cat = c.category || "Umum";
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(c);
            }

            // "Umum" duluan, sisanya alfabetis
            const catNames = Object.keys(byCategory).sort((a, b) => {
                if (a === "Umum") return -1;
                if (b === "Umum") return 1;
                return a.localeCompare(b);
            });

            for (const cat of catNames) {
                text += `\n  _${cat}_\n`;
                text += byCategory[cat].map(formatCmd).join("\n");
            }
        }

        if (groupOnly.length > 0) {
            text += `\n\n👥 *Khusus Grup*\n`;
            text += groupOnly.map(formatCmd).join("\n");
        }

        if (privateOnly.length > 0) {
            text += `\n\n💬 *Khusus Private*\n`;
            text += privateOnly.map(formatCmd).join("\n");
        }

        text += `\n\n━━━━━━━━━━━━━━━━━━`;
        text += `\n💡 Ketik *${PREFIX}help <command>* untuk detail.`;

        await message.reply(text);
    },
};