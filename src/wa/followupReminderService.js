/**
 * FollowupReminderService — reminder ke grup sales untuk lead yang belum di-follow up.
 * Dua sumber, satu mesin:
 *
 *  - "dmu" — lead IM-DMU yang belum ada follow-up sama sekali
 *            (im-dmu: GET /api/followup-reminders) → stage "24h" & "48h" (hard warning).
 *  - "dmc" — Lead Follow-Up sponsor DMC (Send Sponsor Kit → Follow-up 1 → Follow-up 2)
 *            (DMC: GET /api/lead-followup-reminders) → stage "due_soon" (≤24 jam ke deadline
 *            SLA) & "overdue" (hard warning).
 *
 * Cara kerja (per sumber, tiap 15 menit):
 * 1. Poll feed-nya. Aplikasi sumber yang menentukan lead mana yang perlu diingatkan + stage-nya;
 *    lead yang sudah di-follow up tidak pernah muncul di feed.
 * 2. Item yang (source, lead_id, trigger_at, stage)-nya belum ada di tabel followup_reminders
 *    digabung jadi SATU pesan per stage (bukan satu pesan per lead) lalu dikirim ke grup.
 * 3. Baru setelah pesan terkirim, item dicatat di followup_reminders → tidak terkirim dua kali.
 *    Gagal kirim = tidak dicatat = dicoba lagi tick berikutnya.
 *
 * Konfigurasi dibaca dari app_settings tiap tick (halaman /settings, prefix DMU_REMINDER_* /
 * DMC_REMINDER_*), jadi ubah grup / nyalakan-matikan tidak perlu restart.
 * API key di .env: DMU_REMINDER_API_KEY / DMC_REMINDER_API_KEY.
 */

const cron = require("node-cron");
const { getSetting } = require("../db/settings");

const CRON_EXPRESSION = "*/15 * * * *";
const TIMEZONE = "Asia/Jakarta";
const MAX_PER_MESSAGE = 20; // sisanya ikut di tick berikutnya, biar pesan tidak kepanjangan

let task = null;
const running = new Set();

// ── Helpers ───────────────────────────────────────────────

function normalizeNumber(raw) {
    let n = String(raw || "").replace(/\D/g, "");
    if (n.startsWith("0")) n = "62" + n.slice(1);
    return n;
}

function jakartaHour(date = new Date()) {
    return Number(date.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TIMEZONE }));
}

/** "20-8" → true jam 20:00–07:59 WIB. Kosong / format salah = tidak ada jam tenang. */
function inQuietHours(spec, date = new Date()) {
    const m = String(spec || "").trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
    if (!m) return false;
    const start = Number(m[1]);
    const end = Number(m[2]);
    const h = jakartaHour(date);
    return start <= end ? (h >= start && h < end) : (h >= start || h < end);
}

function fmtTime(iso) {
    return new Date(iso).toLocaleString("id-ID", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE,
    });
}

function moreLine(remaining) {
    return remaining ? `\n\n…dan ${remaining} lead lainnya (menyusul).` : "";
}

function tagLine(mentionNumbers) {
    return mentionNumbers.length ? `\n\n${mentionNumbers.map((n) => `@${n}`).join(" ")}` : "";
}

// ── Sumber: IM-DMU ────────────────────────────────────────

function dmuLeadLines(item, index) {
    const who = [item.name || item.email || `Lead #${item.lead_id}`, item.company].filter(Boolean).join(" — ");
    const lines = [`${index + 1}. *${who}*`];
    lines.push(`   📌 ${item.trigger}${item.is_resubmission ? " _(submit ulang)_" : ""}`);
    if (item.phone) lines.push(`   📞 ${item.phone}`);
    lines.push(`   🕒 Masuk ${fmtTime(item.trigger_at)} (${item.hours_since} jam lalu)`);
    lines.push(`   🔗 ${item.url}`);
    return lines.join("\n");
}

function dmuMessage(stage, items, remaining, mentionNumbers) {
    const total = items.length + remaining;
    if (stage === "48h") {
        return (
            `🚨 *HARD WARNING — 48 JAM BELUM DI-FOLLOW UP* 🚨\n` +
            `${total} lead DMU sudah *lebih dari 48 jam* tanpa follow up sama sekali:\n\n` +
            items.map(dmuLeadLines).join("\n\n") +
            moreLine(remaining) +
            `\n\n⚠️ *Wajib di-follow up HARI INI* dan dicatat di DMU.` +
            tagLine(mentionNumbers)
        );
    }
    return (
        `⏰ *Reminder Follow Up Lead DMU*\n` +
        `${total} lead sudah lebih dari 24 jam belum ada follow up:\n\n` +
        items.map(dmuLeadLines).join("\n\n") +
        moreLine(remaining) +
        `\n\nMohon segera di-follow up & catat di DMU ya 🙏`
    );
}

// ── Sumber: DMC Lead Follow-Up (sponsor) ──────────────────

function dmcLeadLines(item, index) {
    const who = [item.name || item.email || `Lead #${item.lead_id}`, item.company].filter(Boolean).join(" — ");
    const lines = [`${index + 1}. *${who}*${item.job_title ? ` (${item.job_title})` : ""}`];
    lines.push(`   📋 ${item.step_label} · PIC: ${item.pic_name || "_belum ada_"}`);
    const when = item.stage === "overdue"
        ? `lewat ${item.hours_overdue} jam`
        : `sisa ${item.hours_left} jam`;
    lines.push(`   ⏳ Deadline ${fmtTime(item.deadline_at)} (${when})`);
    if (item.phone) lines.push(`   📞 ${item.phone}`);
    lines.push(`   🔗 ${item.url}`);
    return lines.join("\n");
}

function dmcMessage(stage, items, remaining, mentionNumbers) {
    const total = items.length + remaining;
    if (stage === "overdue") {
        return (
            `🚨 *HARD WARNING — LEAD SPONSOR LEWAT DEADLINE* 🚨\n` +
            `${total} lead DMC sudah *melewati SLA* follow up:\n\n` +
            items.map(dmcLeadLines).join("\n\n") +
            moreLine(remaining) +
            `\n\n⚠️ *Wajib dikerjakan HARI INI* dan dicatat di menu Lead Follow-Up DMC.` +
            tagLine(mentionNumbers)
        );
    }
    return (
        `⏰ *Reminder Lead Follow-Up Sponsor DMC*\n` +
        `${total} lead mendekati deadline SLA (≤24 jam lagi):\n\n` +
        items.map(dmcLeadLines).join("\n\n") +
        moreLine(remaining) +
        `\n\nMohon segera dikerjakan & dicatat di menu Lead Follow-Up ya 🙏`
    );
}

/**
 * stageOrder: urutan kirim (hard warning dulu — itu yang paling penting kalau ada yang gagal).
 * hardStages: stage yang men-tag nomor di *_REMINDER_MENTIONS.
 */
const SOURCES = {
    dmu: {
        label: "DMU",
        prefix: "DMU_REMINDER",
        apiKeyEnv: "DMU_REMINDER_API_KEY",
        stageOrder: ["48h", "24h"],
        hardStages: ["48h"],
        buildMessage: dmuMessage,
    },
    dmc: {
        label: "DMC",
        prefix: "DMC_REMINDER",
        apiKeyEnv: "DMC_REMINDER_API_KEY",
        stageOrder: ["overdue", "due_soon"],
        hardStages: ["overdue"],
        buildMessage: dmcMessage,
    },
};

async function fetchFeed(apiUrl, apiKeyEnv) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) throw new Error(`${apiKeyEnv} belum di-set di .env`);

    const res = await fetch(apiUrl, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
}

// ── Core ──────────────────────────────────────────────────

/**
 * Satu putaran untuk satu sumber: ambil feed, kirim yang belum pernah terkirim.
 * @param {"dmu"|"dmc"} sourceKey
 * @param {import('./manager')} waManager
 * @param {{ dryRun?: boolean, force?: boolean }} opts
 *   dryRun = tidak kirim & tidak mencatat, hanya kembalikan pesan yang AKAN dikirim.
 *   force  = abaikan *_REMINDER_ENABLED & jam tenang (untuk tes manual).
 */
async function runOnce(sourceKey, waManager, { dryRun = false, force = false } = {}) {
    const { FollowupReminder } = require("../db/models");
    const src = SOURCES[sourceKey];
    if (!src) throw new Error(`Sumber reminder tidak dikenal: ${sourceKey}`);
    const setting = async (name, fallback = "") => String(await getSetting(`${src.prefix}_${name}`, fallback) || "").trim();

    const enabled = (await setting("ENABLED", "0")) === "1";
    if (!enabled && !force) return { skipped: "disabled" };

    const apiUrl = await setting("API_URL");
    const deviceId = await setting("DEVICE_ID");
    let groupId = await setting("GROUP_ID");
    if (!apiUrl || !deviceId || !groupId) {
        return { skipped: `${src.prefix}_API_URL / _DEVICE_ID / _GROUP_ID belum diisi` };
    }
    if (!groupId.endsWith("@g.us")) groupId = `${groupId}@g.us`;

    const quiet = await setting("QUIET_HOURS", "20-8");
    if (!force && inQuietHours(quiet)) return { skipped: `jam tenang (${quiet} WIB)` };

    if (!dryRun) {
        const client = waManager.getClient(deviceId);
        if (!client || !client.info) return { skipped: `device ${deviceId} belum READY` };
    }

    const mentionNumbers = (await setting("MENTIONS")).split(",").map(normalizeNumber).filter(Boolean);

    const feed = await fetchFeed(apiUrl, src.apiKeyEnv);
    if (!feed.length) return { feed: 0, sent: {} };

    // Buang yang sudah pernah terkirim untuk (lead, trigger, stage) yang sama
    const already = await FollowupReminder.findAll({
        where: { source: sourceKey, lead_id: [...new Set(feed.map((i) => i.lead_id))] },
        attributes: ["lead_id", "trigger_at", "stage"],
    });
    const keyOf = (leadId, triggerAt, stage) => `${leadId}|${new Date(triggerAt).getTime()}|${stage}`;
    const sentKeys = new Set(already.map((r) => keyOf(r.lead_id, r.trigger_at, r.stage)));
    const pending = feed.filter((i) => !sentKeys.has(keyOf(i.lead_id, i.trigger_at, i.stage)));

    const result = { feed: feed.length, pending: pending.length, sent: {}, messages: [] };

    for (const stage of src.stageOrder) {
        const all = pending.filter((i) => i.stage === stage);
        if (!all.length) continue;

        const isHard = src.hardStages.includes(stage);
        const batch = all.slice(0, MAX_PER_MESSAGE);
        const text = src.buildMessage(stage, batch, all.length - batch.length, isHard ? mentionNumbers : []);

        if (dryRun) {
            result.messages.push({ stage, text });
            continue;
        }

        const options = isHard && mentionNumbers.length
            ? { mentions: mentionNumbers.map((n) => `${n}@c.us`) }
            : undefined;

        const msg = await waManager.sendText(deviceId, groupId, text, options);

        await FollowupReminder.bulkCreate(batch.map((i) => ({
            source: sourceKey,
            lead_id: i.lead_id,
            trigger_at: new Date(i.trigger_at),
            stage,
            lead_name: i.name,
            company: i.company,
            group_id: groupId,
            message_id: msg?.id?._serialized || null,
        })), { ignoreDuplicates: true });

        result.sent[stage] = batch.length;
    }

    return result;
}

async function tick(sourceKey, waManager) {
    if (running.has(sourceKey)) return; // tick sebelumnya belum selesai
    running.add(sourceKey);
    try {
        const r = await runOnce(sourceKey, waManager);
        if (r.skipped) return; // diam saja: disabled / jam tenang / belum dikonfigurasi
        if (r.pending) {
            console.log(`[Reminder ${SOURCES[sourceKey].label}] feed=${r.feed} pending=${r.pending} sent=${JSON.stringify(r.sent)}`);
        }
    } catch (err) {
        console.error(`[Reminder ${SOURCES[sourceKey].label}] Error:`, err.message);
    } finally {
        running.delete(sourceKey);
    }
}

function init(waManager) {
    if (task) task.stop();
    task = cron.schedule(CRON_EXPRESSION, async () => {
        for (const key of Object.keys(SOURCES)) {
            await tick(key, waManager);
        }
    }, { timezone: TIMEZONE });
    console.log(`[Reminder] Scheduled DMU & DMC follow-up reminders (${CRON_EXPRESSION} ${TIMEZONE})`);
}

module.exports = { init, runOnce, inQuietHours, SOURCES };
