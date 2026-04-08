const { getSettingInt } = require("../../db/settings");

const API_SUMMARY = "https://membership.djakarta-miningclub.com/api/summary-attandance";

function randTag(length = 6) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "checkin",
    aliases: ["ci"],
    description: "Ringkasan check-in DMC (on-demand)",
    usage: "!checkin [event_id]",
    scope: "both",
    category: "Event/DMC",

    async execute({ message, args }) {
        const defaultId = await getSettingInt("EVENT_DEFAULT_ID", 55);
        const eventsId = args[0] ? parseInt(args[0], 10) : defaultId;
        const tag = randTag();

        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 15000);
            const res = await fetch(API_SUMMARY, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event_id: eventsId }),
                signal: ctrl.signal,
            });
            clearTimeout(t);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();

            let totalCheckins = 0;
            let txt = `*DMC Check-in Summary* [${tag}]\nEvent ID: ${eventsId}\n`;

            if (!Array.isArray(rows) || rows.length === 0) {
                txt += "Belum ada data check-in.\n";
            } else {
                for (const row of rows) {
                    const cat = (row.package_category || "").toString();
                    const count = Number(row.count || 0);
                    totalCheckins += count;
                    txt += `• ${cat}: ${count}\n`;
                }
            }

            const now = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
            txt += `\n*Total Checked-in*: ${totalCheckins}`;
            txt += `\n*Update Terakhir*: ${now}`;
            txt += `\nRef: ${tag}`;

            await message.reply(txt.trim());
        } catch (err) {
            console.error("❌ Gagal ambil Check-in Summary (POST):", err?.message || err);
            await message.reply("❌ Gagal mengambil data check-in summary.");
        }
    },
};
