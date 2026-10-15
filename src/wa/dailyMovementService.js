/**
 * DailyMovementService — rekap harian pergerakan lead IM-DMU ke grup sales, tiap pagi.
 *
 * Angkanya dihitung DMU (GET /api/daily-movement, DailyMovementService di im-dmu) — sama persis
 * dengan halaman Reports > Daily Movement di DMU. wa-gateway hanya mengambil & memformat pesan.
 *
 * Jadwal: cek tiap menit; begitu jam WIB ≥ DMU_MOVEMENT_TIME (default 08:30) dan rekap hari ini
 * belum terkirim, kirim rekap KEMARIN. Tanggal terakhir terkirim disimpan di app_settings
 * (DMU_MOVEMENT_LAST_SENT), jadi restart app tidak membuat rekap dobel, dan app yang baru hidup
 * jam 09:00 tetap mengirim — maksimal CATCH_UP_HOURS setelah jadwal, lewat dari itu dilewati.
 *
 * Device & API key ikut reminder DMU (DMU_REMINDER_DEVICE_ID, DMU_REMINDER_API_KEY).
 * Grup: DMU_MOVEMENT_GROUP_ID, kosong = sama dengan DMU_REMINDER_GROUP_ID.
 */

const cron = require("node-cron");
const { getSetting, setSetting } = require("../db/settings");

const TIMEZONE = "Asia/Jakarta";
const FETCH_TIMEOUT_MS = 30_000;
const CATCH_UP_HOURS = 4;
const LAST_SENT_KEY = "DMU_MOVEMENT_LAST_SENT";

let task = null;
let running = false;
let lastRun = null;

const SOURCE_LABELS = { website: "Website", event: "Event", import: "Import", manual: "Manual", unknown: "Lainnya" };

// ── Helpers ───────────────────────────────────────────────

/** Tanggal & menit-ke-berapa hari ini di WIB */
function jakartaNow(date = new Date()) {
    const day = date.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // YYYY-MM-DD
    const [h, m] = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE })
        .split(":").map(Number);
    return { day, minutes: h * 60 + m };
}

function parseTime(spec) {
    const m = String(spec || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

async function setting(name, fallback = "") {
    return String(await getSetting(name, fallback) || "").trim();
}

async function resolveConfig() {
    const reminderApi = await setting("DMU_REMINDER_API_URL");
    let apiUrl = await setting("DMU_MOVEMENT_API_URL");
    if (!apiUrl && reminderApi) {
        // https://dmu.../api/followup-reminders → https://dmu.../api/daily-movement
        apiUrl = reminderApi.replace(/\/followup-reminders\/?(\?.*)?$/, "/daily-movement");
    }
    let groupId = (await setting("DMU_MOVEMENT_GROUP_ID")) || (await setting("DMU_REMINDER_GROUP_ID"));
    if (groupId && !groupId.endsWith("@g.us")) groupId = `${groupId}@g.us`;

    return {
        enabled: (await setting("DMU_MOVEMENT_ENABLED", "0")) === "1",
        time: (await setting("DMU_MOVEMENT_TIME", "08:30")) || "08:30",
        apiUrl,
        deviceId: await setting("DMU_REMINDER_DEVICE_ID"),
        groupId,
    };
}

async function fetchMovement(apiUrl, date) {
    const apiKey = process.env.DMU_REMINDER_API_KEY;
    if (!apiKey) throw new Error("DMU_REMINDER_API_KEY belum di-set di .env");

    const url = date ? `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}date=${encodeURIComponent(date)}` : apiUrl;
    const res = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`DMU API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    if (!json || !json.date || !json.incoming) throw new Error("Respons DMU /daily-movement tidak dikenali");
    return json;
}

function buildMessage(m) {
    const lines = [`📊 *Daily Movement Lead DMU*`, m.date_label, ""];

    // Masuk
    const sources = Object.entries(m.incoming.by_source || {})
        .map(([k, v]) => `${SOURCE_LABELS[k] || k} ${v}`).join(", ");
    lines.push("*Masuk*");
    lines.push(`• Lead baru: ${m.incoming.new_leads}${sources ? ` (${sources})` : ""}`);
    lines.push(`• Submit ulang: ${m.incoming.resubmissions}`);
    lines.push("");

    // Follow-up
    lines.push(`*Follow-up dicatat: ${m.followups.total}*${m.followups.total ? ` (${m.followups.leads_touched} lead)` : ""}`);
    if (m.followups.by_user.length) {
        lines.push("• " + m.followups.by_user.map((u) => `${u.name}: ${u.count}`).join(" · "));
    } else {
        lines.push("• Belum ada follow-up yang dicatat ⚠️");
    }
    lines.push("");

    // Pergerakan status — hanya yang ada angkanya, biar ringkas
    const s = m.status;
    const outcomes = Object.values(s.outcomes || {}).filter((o) => o.count > 0)
        .map((o) => `${o.label}: ${o.count}`).join(" · ");
    const statusLines = [];
    if (outcomes) statusLines.push(`• ${outcomes}`);
    if (s.backend_declines) statusLines.push(`   ↳ ${s.backend_declines} decline di antaranya dari backend-admin`);
    statusLines.push(`• Registered${s.registered_edition ? ` ${s.registered_edition}` : ""}: ${s.registered}`);
    const temp = [s.temperature_up.hot ? `Hot ${s.temperature_up.hot}` : null, s.temperature_up.warm ? `Warm ${s.temperature_up.warm}` : null]
        .filter(Boolean).join(" · ");
    if (temp) statusLines.push(`• Naik jadi ${temp}`);
    if (s.archived) statusLines.push(`• Diarsipkan: ${s.archived}`);
    lines.push("*Pergerakan status*", ...statusLines, "");

    // PR
    const t = m.todo;
    lines.push("*PR hari ini*");
    if (t.unfollowed) {
        lines.push(`• Belum di-follow up >24 jam: ${t.unfollowed.over_24h}`);
        lines.push(`• >48 jam (overdue): ${t.unfollowed.over_48h}${t.unfollowed.over_48h ? " 🚨" : ""}`);
    }
    lines.push(`• Jadwal follow-up hari ini: ${t.scheduled_today}`);

    if (m.url) lines.push("", `🔗 ${m.url}`);
    return lines.join("\n");
}

// ── Core ──────────────────────────────────────────────────

/**
 * Ambil rekap & kirim ke grup.
 * @param {{ dryRun?: boolean, date?: string }} opts  date = YYYY-MM-DD, kosong = kemarin (default DMU)
 */
async function runOnce(waManager, { dryRun = false, date = null } = {}) {
    const cfg = await resolveConfig();
    if (!cfg.apiUrl) return { skipped: "URL API belum diisi (DMU_MOVEMENT_API_URL / DMU_REMINDER_API_URL)" };
    if (!dryRun && (!cfg.deviceId || !cfg.groupId)) {
        return { skipped: "Device / grup belum diisi (ikut setting reminder DMU)" };
    }
    if (!dryRun) {
        const client = waManager.getClient(cfg.deviceId);
        if (!client || !client.info) return { skipped: `device ${cfg.deviceId} belum READY` };
    }

    const movement = await fetchMovement(cfg.apiUrl, date);
    const text = buildMessage(movement);
    if (dryRun) return { date: movement.date, text };

    await waManager.sendText(cfg.deviceId, cfg.groupId, text);
    return { date: movement.date, sent: true, groupId: cfg.groupId };
}

async function tick(waManager) {
    if (running) return;
    running = true;
    try {
        const cfg = await resolveConfig();
        if (!cfg.enabled) return;

        const target = parseTime(cfg.time);
        if (target == null) return;
        const { day, minutes } = jakartaNow();
        if (minutes < target || minutes > target + CATCH_UP_HOURS * 60) return;
        if ((await setting(LAST_SENT_KEY)) === day) return; // sudah terkirim hari ini

        const r = await runOnce(waManager);
        lastRun = { at: new Date(), result: r };
        if (r.sent) {
            await setSetting(LAST_SENT_KEY, day, "Tanggal (WIB) Daily Movement DMU terakhir terkirim — diisi otomatis");
            console.log(`[Daily Movement] Rekap ${r.date} terkirim ke ${r.groupId}`);
        }
    } catch (err) {
        lastRun = { at: new Date(), error: err.message };
        console.error("[Daily Movement] Error:", err.message);
    } finally {
        running = false;
    }
}

async function getStatus() {
    return { lastRun, lastSent: await setting(LAST_SENT_KEY), config: await resolveConfig() };
}

function init(waManager) {
    if (task) task.stop();
    task = cron.schedule("* * * * *", () => tick(waManager), { timezone: TIMEZONE });
    console.log("[Daily Movement] Scheduled (cek tiap menit, kirim sekali sehari di DMU_MOVEMENT_TIME WIB)");
}

module.exports = { init, runOnce, getStatus, buildMessage, parseTime };
