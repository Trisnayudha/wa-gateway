/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "broadcast",
    aliases: ["bc", "blast"],
    description: "Broadcast pesan ke semua grup yang diikuti bot",
    usage: "!broadcast <pesan>",
    scope: "private", // hanya bisa dari private chat (keamanan)
    adminOnly: false,

    async execute({ message, client, args }) {
        if (args.length === 0) {
            return message.reply(
                "❌ Pesan broadcast tidak boleh kosong.\n" +
                "Contoh: *!broadcast Halo semua!*"
            );
        }

        const broadcastMsg = args.join(" ");

        // Ambil semua grup lewat wa.getGroupChats agar tidak memicu serialization error "r"
        let groups;
        try {
            const wa = require("../manager");
            const rawGroups = await wa.getGroupChats(deviceId);
            groups = (rawGroups || []).map((g) => ({
                id: g.id?._serialized || (typeof g.id === "string" ? g.id : null),
                name: g.formattedTitle || g.name || null,
            })).filter((g) => !!g.id);
        } catch (err) {
            return message.reply(`⚠️ Gagal mengambil daftar chat: ${err.message}`);
        }

        if (groups.length === 0) {
            return message.reply("⚠️ Bot tidak bergabung di grup manapun.");
        }

        await message.reply(
            `📤 Memulai broadcast ke *${groups.length}* grup...\nPesan: _${broadcastMsg}_`
        );

        let successCount = 0;
        let failCount = 0;
        const failedGroups = [];

        for (const group of groups) {
            try {
                await client.sendMessage(group.id, `📢 *Broadcast*\n\n${broadcastMsg}`);
                successCount++;

                // Delay 1.5 detik antar grup agar tidak terlalu cepat (anti-spam)
                await new Promise((r) => setTimeout(r, 1500));
            } catch (err) {
                failCount++;
                failedGroups.push(group.name || group.id);
                console.error(`[broadcast] Failed to ${group.id}:`, err.message);
            }
        }

        let resultMsg = `✅ Broadcast selesai!\n• Berhasil: *${successCount}* grup\n• Gagal: *${failCount}* grup`;

        if (failedGroups.length > 0) {
            resultMsg += `\n\nGrup yang gagal:\n${failedGroups.map((n) => `  - ${n}`).join("\n")}`;
        }

        await message.reply(resultMsg);
    },
};