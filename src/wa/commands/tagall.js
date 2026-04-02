/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "tagall",
    aliases: ["mentionall", "everyone"],
    description: "Mention semua anggota grup",
    usage: "!tagall [pesan]",
    scope: "group",
    adminOnly: false, // set true jika hanya admin boleh tag all

    async execute({ message, args }) {
        const chat = await message.getChat();

        if (!chat.isGroup) {
            return message.reply("❌ Command ini hanya untuk grup.");
        }

        const participants = chat.participants || [];

        if (participants.length === 0) {
            return message.reply("⚠️ Tidak ada anggota yang bisa di-mention.");
        }

        const customMsg = args.join(" ") || "📢 Perhatian!";
        const mentions = participants.map((p) => p.id._serialized);

        // Format mention teks: @62xxx
        const mentionText = participants
            .map((p) => `@${p.id.user}`)
            .join(" ");

        const text = `${customMsg}\n\n${mentionText}`;

        await chat.sendMessage(text, { mentions });
    },
};