/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "grupid",
    aliases: ["idgrup", "gid"],
    description: "Cek ID dan informasi grup WhatsApp saat ini",
    usage: "!grupid",
    scope: "group", // Hanya bisa digunakan di grup
    adminOnly: false,

    async execute({ message, client }) {
        const isGroup = message.from.endsWith("@g.us");
        if (!isGroup) {
            return message.reply("❌ Command ini hanya bisa digunakan di dalam grup.");
        }

        const groupId = message.from;
        let groupName = "Grup WhatsApp";
        let totalMembers = "-";

        // Ambil info nama & anggota grup secara aman tanpa getChat() yang memicu error "r" pada WhatsApp Web
        if (client && client.pupPage) {
            try {
                const info = await client.pupPage.evaluate((id) => {
                    try {
                        const collections = window.require("WAWebCollections");
                        const Chat = collections.Chat || collections.WAWebChatCollection;
                        const GroupMetadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
                        const WidFactory = window.require ? window.require("WAWebWidFactory") : null;

                        const wid = WidFactory ? WidFactory.createWid(id) : null;
                        const chat = (wid && Chat ? Chat.get(wid) : null) || (Chat ? Chat.get(id) : null);
                        const gm = chat?.groupMetadata || (wid && GroupMetadata ? GroupMetadata.get(wid) : null) || (GroupMetadata ? GroupMetadata.get(id) : null);

                        let count = null;
                        if (gm) {
                            if (typeof gm.size === "number" && gm.size > 0) count = gm.size;
                            else if (gm.participants) {
                                const p = gm.participants;
                                if (typeof p.length === "number" && p.length > 0) count = p.length;
                                else if (typeof p.size === "number" && p.size > 0) count = p.size;
                                else if (Array.isArray(p)) count = p.length;
                                else if (Array.isArray(p._models)) count = p._models.length;
                            }
                        }

                        return {
                            name: chat?.formattedTitle || chat?.name || gm?.subject || null,
                            membersCount: count,
                        };
                    } catch (_) {
                        return null;
                    }
                }, groupId);

                if (info?.name) groupName = info.name;
                if (info?.membersCount) totalMembers = info.membersCount;
            } catch (_) {
                // Fallback aman jika evaluate gagal
            }
        }

        const text =
            `📋 *Informasi Grup*\n\n` +
            `• *Nama Grup*    : ${groupName}\n` +
            `• *ID Grup*      : \`${groupId}\`\n` +
            `• *Total Anggota*: ${totalMembers}\n\n` +
            `💡 _Salin ID grup di atas untuk kebutuhan broadcast, scheduler, atau whitelist bot._`;

        await message.reply(text);
    },
};
