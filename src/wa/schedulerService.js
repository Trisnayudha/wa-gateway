/**
 * SchedulerService — Dynamic cron manager untuk event summary DMC.
 *
 * Cara kerja:
 * 1. Saat boot: `init()` dipanggil → semua scheduler aktif dimuat dari DB.
 * 2. Admin buat/edit/toggle → panggil `reload(id)` supaya job lama distop & diganti baru.
 * 3. Admin hapus → panggil `stop(id)`.
 */

const cron = require("node-cron");

// jobs: schedulerId (UUID) -> cron.ScheduledTask
const jobs = new Map();

// ── Helpers ───────────────────────────────────────────────

function fmtDate(timezone) {
    const now = new Date();
    return now.toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        timeZone: timezone || "Asia/Jakarta",
    }); // e.g. "8 Apr 2026"
}

/** Normalise package category dari API ke label baku. */
function mapCategory(raw) {
    const s = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
    if (s.includes("nonmember") || s.includes("nonmem"))  return "Non-Member";
    if (s.includes("member") || s.includes("premium"))    return "Member";
    if (s.includes("sponsor"))                            return "Sponsor";
    if (s.includes("free") || s.includes("complimentary") || s.includes("invitation")) return "Complimentary";
    // fallback: title-case aslinya
    return String(raw).trim();
}

/** Urutan tampil di pesan registration */
const DISPLAY_ORDER = ["Member", "Non-Member", "Sponsor", "Complimentary"];

function buildCheckinMessage(name, list, timezone) {
    let total = 0;
    let body = "";
    for (const row of list) {
        body += `• ${row.package_category}: ${row.count}\n`;
        total += Number(row.count || 0);
    }
    const time = new Date().toLocaleTimeString("id-ID", { timeZone: timezone || "Asia/Jakarta" });
    return (
        `*${name}*\n` +
        (body || "Belum ada peserta yang check-in.\n") +
        `\n*Total Checked-in*: ${total}` +
        `\n*Update Terakhir*: ${time}`
    );
}

function buildRegistrationMessage(name, list, timezone) {
    // Gabungkan per kategori yang sudah di-map
    const totals = {};
    let grand = 0;
    for (const row of list) {
        const label = mapCategory(row.package_category);
        totals[label] = (totals[label] || 0) + Number(row.count || 0);
        grand += Number(row.count || 0);
    }

    const date = fmtDate(timezone);
    let lines = `[${date}]\n${name}\n\n*Total Registrants: ${grand}*\n\n`;

    // Tampilkan sesuai urutan baku, sisanya di belakang
    const ordered = [
        ...DISPLAY_ORDER.filter((k) => totals[k] != null),
        ...Object.keys(totals).filter((k) => !DISPLAY_ORDER.includes(k)),
    ];
    for (const label of ordered) {
        lines += `${label}: ${totals[label]}\n`;
    }

    return lines.trim();
}

/**
 * Jalankan satu job berdasarkan row EventScheduler.
 * @param {object} scheduler - instance EventScheduler
 * @param {import('../wa/manager')} waManager
 */
function startJob(scheduler, waManager) {
    const { id, name, device_id, event_id, group_id, cron_expression, timezone, api_url, scheduler_type } = scheduler;

    if (!cron.validate(cron_expression)) {
        console.warn(`[Scheduler] Invalid cron expression for "${name}" (${id}): ${cron_expression}`);
        return;
    }

    const task = cron.schedule(cron_expression, async () => {
        const ts = new Date().toLocaleTimeString("id-ID", { timeZone: timezone || "Asia/Jakarta" });
        console.log(`[Scheduler] Triggered "${name}" at ${ts} → event_id=${event_id}, group=${group_id}`);

        // Pastikan device READY sebelum kirim
        const client = waManager.getClient(device_id);
        if (!client || !client.info) {
            console.warn(`[Scheduler] "${name}" skipped — device ${device_id} not ready`);
            return;
        }

        try {
            // Semua tipe pakai POST + JSON body
            const res = await fetch(api_url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ event_id }),
            });
            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`API HTTP ${res.status}: ${body}`);
            }
            const rows = await res.json();

            // API bisa return array langsung atau { data: [...] }
            const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : []);

            const message = scheduler_type === "registration"
                ? buildRegistrationMessage(name, list, timezone)
                : buildCheckinMessage(name, list, timezone);

            await waManager.sendText(device_id, group_id, message);
            console.log(`[Scheduler] "${name}" (${scheduler_type}) sent OK`);
        } catch (err) {
            console.error(`[Scheduler] Error "${name}":`, err.message);
        }
    }, { timezone: timezone || "Asia/Jakarta" });

    jobs.set(id, task);
    console.log(`[Scheduler] Started "${name}" (${cron_expression} ${timezone})`);
}

function stopJob(schedulerId) {
    const task = jobs.get(schedulerId);
    if (task) {
        task.stop();
        jobs.delete(schedulerId);
    }
}

/**
 * Init: load semua scheduler aktif dari DB dan jadwalkan.
 * Dipanggil sekali saat server boot (setelah DB sync).
 */
async function init(waManager) {
    const { EventScheduler } = require("../db/models");
    const active = await EventScheduler.findAll({ where: { is_active: true } });
    for (const s of active) {
        startJob(s, waManager);
    }
    console.log(`[Scheduler] Init complete. ${active.length} job(s) started.`);
}

/**
 * Reload satu scheduler: stop job lama (jika ada) lalu start baru jika aktif.
 * Panggil ini setelah admin create/update/toggle.
 */
async function reload(schedulerId, waManager) {
    const { EventScheduler } = require("../db/models");
    stopJob(schedulerId);

    const s = await EventScheduler.findByPk(schedulerId);
    if (s && s.is_active) {
        startJob(s, waManager);
    }
}

/**
 * Stop dan hapus job. Panggil saat admin delete scheduler.
 */
function stop(schedulerId) {
    stopJob(schedulerId);
}

/**
 * Status semua job yang sedang berjalan.
 */
function runningIds() {
    return [...jobs.keys()];
}

module.exports = { init, reload, stop, runningIds };
