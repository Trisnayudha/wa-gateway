// Helper untuk command peserta/detail event DMC
// Pakai fetch built-in (Node 18+)
const { MessageMedia } = require("whatsapp-web.js");

const API_LIST = "https://membership.djakarta-miningclub.com/api/attendance-by-package";
const API_DETAIL = "https://membership.djakarta-miningclub.com/api/user-detail-by-codepayment";

const toUpperSafe = (s) => (s || "").toString().trim().toUpperCase();

// urutkan kategori → SPONSORS dulu, lalu DELEGATES, baru yang lain
const ORDER = { SPONSORS: 0, DELEGATES: 1 };
const sortCategories = (categories = []) =>
    [...categories].sort((a, b) => {
        const A = toUpperSafe(a.category);
        const B = toUpperSafe(b.category);
        const wa = ORDER[A] ?? 2;
        const wb = ORDER[B] ?? 2;
        return wa === wb ? A.localeCompare(B) : wa - wb;
    });

const fmtLine = (att) => {
    const name = att?.name || "-";
    const code = att?.codepayment || att?.code_payment || att?.code || "-";
    const company = att?.company || att?.company_name || att?.organization || null;
    return company ? `- ${name} from ${company} ( ${code} )` : `- ${name} ( ${code} )`;
};

async function fetchJson(url, options = {}, timeout = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

module.exports = {
    // ✅ LIST PESERTA TANPA PAGE
    async handleListParticipants(message, { eventsId }) {
        try {
            const url = `${API_LIST}?event_id=${encodeURIComponent(eventsId)}`;
            const data = await fetchJson(url);

            const categories = Array.isArray(data?.categories) ? data.categories : [];
            const total = Number.isFinite(data?.total_attendees) ? data.total_attendees : 0;

            if (!categories.length) {
                await message.reply(`*Participants by Package*\nEvent ID: ${eventsId}\nBelum ada peserta.`);
                return;
            }

            const ordered = sortCategories(categories);
            const output = [`*Participants by Package* (Event ID: ${eventsId})`];

            for (const cat of ordered) {
                const title = toUpperSafe(cat.category);
                const attendees = Array.isArray(cat.attendees) ? cat.attendees : [];
                output.push(`\n${title}`);
                output.push(attendees.length ? attendees.map(fmtLine).join("\n") : "- (kosong)");
            }

            output.push(`\nTotal Attendees: ${total}`);

            await message.reply(output.join("\n"));
        } catch (err) {
            console.error("handleListParticipants error:", err);
            await message.reply("❌ Gagal mengambil daftar peserta.");
        }
    },

    // ✅ DETAIL PESERTA
    async handleParticipantDetail(message, { codepayment, eventsId }) {
        const url = `${API_DETAIL}/${encodeURIComponent(codepayment)}?event_id=${encodeURIComponent(eventsId)}`;
        try {
            const data = await fetchJson(url);

            const pkg = toUpperSafe(data?.package || "");
            const users = Array.isArray(data?.users) ? data.users : [];

            if (!users.length) return await message.reply("❌ Peserta tidak ditemukan.");

            const u = users[0];
            const name = u?.name || "-";
            const photo = u?.photo || null;
            const present = u?.present || "-";
            const company = u?.company || "-";
            const job = u?.job || "-";

            const caption =
                "*Participant Detail*\n" +
                `Event ID: ${eventsId}\n` +
                `Code: ${codepayment}\n` +
                `Package: ${pkg}\n` +
                `Name: ${name}\n` +
                `Company: ${company}\n` +
                `Job Title: ${job}\n` +
                `Present: ${present}`;

            if (photo && /^https?:\/\//i.test(photo)) {
                try {
                    const ctrl = new AbortController();
                    const t = setTimeout(() => ctrl.abort(), 15000);
                    const r = await fetch(photo, { signal: ctrl.signal });
                    clearTimeout(t);
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const mime = r.headers.get("content-type") || "image/jpeg";
                    const buf = Buffer.from(await r.arrayBuffer());
                    const media = new MessageMedia(mime, buf.toString("base64"), "photo.jpg");
                    return await message.reply(media, undefined, { caption });
                } catch {
                    return await message.reply(`${caption}\nPhoto: ${photo}`);
                }
            }

            return await message.reply(caption);
        } catch (err) {
            console.error("handleParticipantDetail error:", err);
            await message.reply("❌ Gagal mengambil detail peserta.");
        }
    },
};
