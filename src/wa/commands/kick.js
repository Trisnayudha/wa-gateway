/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "kick",
    aliases: ["remove"],
    description: "Keluarkan anggota dari grup",
    usage: "!kick @user",
    scope: "group",
    adminOnly: true,

    async execute({ message, client }) {
        const chat = await message.getChat();

        if (!chat.isGroup) {
            return message.reply("❌ Command ini hanya untuk grup.");
        }

        // Harus reply ke pesan target
        if (!message.hasQuotedMsg) {
            return message.reply(
                "❌ Balas (reply) pesan anggota yang ingin di-kick.\n" +
                "Contoh: Reply pesan seseorang lalu ketik *!kick*"
            );
        }

        const quoted = await message.getQuotedMessage();
        const targetId = quoted.author || quoted.from;

        if (!targetId) {
            return message.reply("❌ Tidak bisa mendapatkan ID anggota target.");
        }

        // Pastikan target bukan bot sendiri
        const botNumber = client.info?.wid?._serialized;
        if (targetId === botNumber) {
            return message.reply("❌ Tidak bisa kick diri sendiri (bot).");
        }

        // Pastikan target bukan admin
        const participants = chat.participants || [];
        const targetParticipant = participants.find((p) => p.id._serialized === targetId);

        if (!targetParticipant) {
            return message.reply("❌ Anggota tidak ditemukan di grup ini.");
        }

        if (targetParticipant.isAdmin || targetParticipant.isSuperAdmin) {
            return message.reply("❌ Tidak bisa kick sesama admin.");
        }

        try {
            await chat.removeParticipants([targetId]);
            await message.reply(`✅ @${targetParticipant.id.user} berhasil dikeluarkan dari grup.`, null, {
                mentions: [targetId],
            });
        } catch (err) {
            console.error("[kick] Error:", err.message);
            await message.reply(`⚠️ Gagal kick anggota: ${err.message}`);
        }
    },
};