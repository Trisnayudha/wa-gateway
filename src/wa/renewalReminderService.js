/**
 * RenewalReminderService — reminder bulanan ke grup finance: sponsor DMC yang kontraknya
 * berakhir (bulan ini / bulan depan / sudah lewat) tapi renewal form-nya belum di-generate.
 *
 * Data dari DMC (GET /api/sponsor-renewal-reminders, SponsorRenewalReminderController) — sponsor
 * otomatis hilang dari feed begitu renewal form di-generate atau renewal di-confirm.
 *
 * Jadwal: sebulan sekali, tanggal DMC_RENEWAL_REMINDER_DAY (default 20) jam
 * DMC_RENEWAL_REMINDER_TIME WIB (default 09:00). Tanggal kirim jatuh Sabtu/Minggu → hari kerja
 * berikutnya. Kalau app sempat mati, masih dikejar sampai LAST_DAY (22) — selalu sebelum tgl 23.
 * Bulan terakhir terkirim disimpan di app_settings (DMC_RENEWAL_REMINDER_LAST_SENT), jadi restart
 * tidak membuat pesan dobel.
 *
 * Device, API URL & API key ikut reminder DMC (DMC_REMINDER_DEVICE_ID, DMC_REMINDER_API_URL,
 * DMC_REMINDER_API_KEY). Grup: DMC_RENEWAL_REMINDER_GROUP_ID, kosong = DMC_REMINDER_GROUP_ID.
 */

const cron = require("node-cron");
const { getSetting, setSetting } = require("../db/settings");

const TIMEZONE = "Asia/Jakarta";
const FETCH_TIMEOUT_MS = 30_000;
const LAST_DAY = 22; // batas kejar — reminder harus keluar sebelum tanggal 23
const LAST_SENT_KEY = "DMC_RENEWAL_REMINDER_LAST_SENT";

let task = null;
let running = false;
let lastRun = null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── Helpers ───────────────────────────────────────────────

/** Tanggal, hari (0=Min), menit-ke-berapa & bulan (YYYY-MM) hari ini di WIB */
function jakartaNow(date = new Date()) {
    const ymd = date.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // YYYY-MM-DD
    const [y, mo, d] = ymd.split("-").map(Number);
    const [h, m] = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE })
        .split(":").map(Number);
    return { year: y, month: mo, dayOfMonth: d, weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(), minutes: h * 60 + m, monthKey: ymd.slice(0, 7) };
}

function parseTime(spec) {
    const m = String(spec || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

/** Tanggal kirim bulan ini: hari yang di-set, digeser ke Senin kalau jatuh Sabtu/Minggu. */
function sendDayOfMonth(year, month, day) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 6) return day + 2; // Sabtu → Senin
    if (weekday === 0) return day + 1; // Minggu → Senin
    return day;
}

async function setting(name, fallback = "") {
    return String(await getSetting(name, fallback) || "").trim();
}

async function resolveConfig() {
    const reminderApi = await setting("DMC_REMINDER_API_URL");
    let apiUrl = await setting("DMC_RENEWAL_REMINDER_API_URL");
    if (!apiUrl && reminderApi) {
        // https://…/api/lead-followup-reminders → https://…/api/sponsor-renewal-reminders
        apiUrl = reminderApi.replace(/\/lead-followup-reminders\/?(\?.*)?$/, "/sponsor-renewal-reminders");
    }
    let groupId = (await setting("DMC_RENEWAL_REMINDER_GROUP_ID")) || (await setting("DMC_REMINDER_GROUP_ID"));
    if (groupId && !groupId.endsWith("@g.us")) groupId = `${groupId}@g.us`;

    const day = parseInt(await setting("DMC_RENEWAL_REMINDER_DAY", "20"), 10);

    return {
        enabled: (await setting("DMC_RENEWAL_REMINDER_ENABLED", "0")) === "1",
        day: day >= 1 && day <= LAST_DAY ? day : 20,
        time: (await setting("DMC_RENEWAL_REMINDER_TIME", "09:00")) || "09:00",
        apiUrl,
        deviceId: await setting("DMC_REMINDER_DEVICE_ID"),
        groupId,
    };
}

async function fetchReminders(apiUrl) {
    const apiKey = process.env.DMC_REMINDER_API_KEY;
    if (!apiKey) throw new Error("DMC_REMINDER_API_KEY belum di-set di .env");

    const res = await fetch(apiUrl, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`DMC API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new Error("Respons DMC /sponsor-renewal-reminders tidak dikenali");
    return json;
}

function monthLabel(ym) {
    const [y, m] = String(ym || "").split("-").map(Number);
    return y && m ? `${MONTHS[m - 1]} ${y}` : ym;
}

const STAGES = [
    { key: "overdue", title: "🚨 *Contract already ended*" },
    { key: "this_month", title: "⏳ *Contract ends this month*" },
    { key: "next_month", title: "📆 *Contract ends next month*" },
];

/** Pesan (English — aturan wording DMC). Feed kosong → pesan "all clear". */
function buildMessage(feed) {
    const lines = [`📋 *Sponsor Renewal Reminder — ${monthLabel(feed.month)}*`, ""];

    if (!feed.data.length) {
        lines.push("All sponsors with contracts ending soon already have a renewal form. ✅");
        return lines.join("\n");
    }

    lines.push(`The following ${feed.data.length} sponsor${feed.data.length > 1 ? "s" : ""} still need a renewal form. Please generate them before the 23rd.`, "");

    for (const stage of STAGES) {
        const items = feed.data.filter((s) => s.stage === stage.key);
        if (!items.length) continue;
        lines.push(stage.title);
        for (const s of items) {
            const name = s.branding_name || s.name;
            const pic = s.pic_name ? ` · PIC: ${s.pic_name}` : "";
            lines.push(`• ${name} (${s.package_label}) — ends ${monthLabel(s.contract_end)}${pic}`);
        }
        lines.push("");
    }

    const url = feed.data[0] && feed.data[0].url;
    if (url) lines.push(`🔗 ${url.replace(/\?.*$/, "")}`);
    return lines.join("\n").trim();
}

// ── Core ──────────────────────────────────────────────────

/** Ambil feed & kirim ke grup. dryRun = hanya kembalikan teks. */
async function runOnce(waManager, { dryRun = false } = {}) {
    const cfg = await resolveConfig();
    if (!cfg.apiUrl) return { skipped: "URL API belum diisi (DMC_RENEWAL_REMINDER_API_URL / DMC_REMINDER_API_URL)" };
    if (!dryRun && (!cfg.deviceId || !cfg.groupId)) {
        return { skipped: "Device / grup belum diisi (DMC_REMINDER_DEVICE_ID, DMC_RENEWAL_REMINDER_GROUP_ID)" };
    }
    if (!dryRun) {
        const client = waManager.getClient(cfg.deviceId);
        if (!client || !client.info) return { skipped: `device ${cfg.deviceId} belum READY` };
    }

    const feed = await fetchReminders(cfg.apiUrl);
    const text = buildMessage(feed);
    if (dryRun) return { count: feed.data.length, text };

    await waManager.sendText(cfg.deviceId, cfg.groupId, text);
    return { count: feed.data.length, sent: true, groupId: cfg.groupId };
}

async function tick(waManager) {
    if (running) return;
    running = true;
    try {
        const cfg = await resolveConfig();
        if (!cfg.enabled) return;

        const target = parseTime(cfg.time);
        if (target == null) return;

        const now = jakartaNow();
        const sendDay = sendDayOfMonth(now.year, now.month, cfg.day);
        if (now.dayOfMonth < sendDay || now.dayOfMonth > LAST_DAY) return;
        if (now.dayOfMonth === sendDay && now.minutes < target) return;
        if (now.weekday === 0 || now.weekday === 6) return; // kejar-kejaran juga hanya di hari kerja
        if ((await setting(LAST_SENT_KEY)) === now.monthKey) return; // sudah terkirim bulan ini

        const r = await runOnce(waManager);
        lastRun = { at: new Date(), result: r };
        if (r.sent) {
            await setSetting(LAST_SENT_KEY, now.monthKey, "Bulan (YYYY-MM) reminder renewal sponsor DMC terakhir terkirim — diisi otomatis");
            console.log(`[Renewal Reminder] ${r.count} sponsor terkirim ke ${r.groupId}`);
        }
    } catch (err) {
        lastRun = { at: new Date(), error: err.message };
        console.error("[Renewal Reminder] Error:", err.message);
    } finally {
        running = false;
    }
}

async function getStatus() {
    return { lastRun, lastSent: await setting(LAST_SENT_KEY), config: await resolveConfig() };
}

function init(waManager) {
    if (task) task.stop();
    task = cron.schedule("*/10 * * * *", () => tick(waManager), { timezone: TIMEZONE });
    console.log("[Renewal Reminder] Scheduled (sebulan sekali, tgl DMC_RENEWAL_REMINDER_DAY sebelum tgl 23, jam DMC_RENEWAL_REMINDER_TIME WIB)");
}

module.exports = { init, runOnce, getStatus, buildMessage, sendDayOfMonth };
