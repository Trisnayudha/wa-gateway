/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "mute",
    aliases: ["lock"],
    description: "Kunci grup — hanya admin yang bisa kirim pesan",
    usage: "!mute",
    scope: "group",
    adminOnly: true,

    async execute({ message }) {
        const chat = await message.getChat();

        if (!chat.isGroup) {
            return message.reply("❌ Command ini hanya untuk grup.");
        }

        try {
            // onlyAdminsCanSend: true = mute grup
            await chat.setMessagesAdminsOnly(true);
            await message.reply("🔇 Grup telah di-*mute*. Hanya admin yang bisa mengirim pesan.");
        } catch (err) {
            console.error("[mute] Error:", err.message);
            await message.reply(`⚠️ Gagal mute grup: ${err.message}`);
        }
    },
};