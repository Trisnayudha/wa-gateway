/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "ping",
    aliases: ["p"],
    description: "Cek apakah bot aktif",
    usage: "!ping",
    scope: "both", // group | private | both

    async execute({ message }) {
        const start = Date.now();
        const sent = await message.reply("🏓 Pinging...");
        const latency = Date.now() - start;
        await sent.edit(`🏓 Pong! Latency: *${latency}ms*`);
    },
};