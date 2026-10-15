// Helper untuk app_settings (key-value generic)
// - REGISTRY = daftar setting yang dikenal oleh aplikasi (di-render di UI admin)
// - getSetting()/setSetting() pakai cache TTL 30s biar gak hit DB tiap command
const { AppSetting } = require("./models");

// Daftar setting yang dideklarasikan di code.
// Tambah entry di sini kalau mau setting baru muncul di /settings UI.
const REGISTRY = [
    {
        key: "EVENT_DEFAULT_ID",
        defaultValue: "55",
        description: "Default event ID untuk command !peserta, !detail, !checkin (DMC)",
        type: "number",
    },
    // ── Reminder follow-up lead IM-DMU (src/wa/followupReminderService.js) ──
    // API key-nya di .env (DMU_REMINDER_API_KEY), bukan di sini — secret tidak tampil di UI.
    {
        key: "DMU_REMINDER_ENABLED",
        defaultValue: "0",
        description: "1 = aktifkan reminder lead DMU yang belum di-follow up (24h & 48h), 0 = mati",
        type: "number",
    },
    {
        key: "DMU_REMINDER_API_URL",
        defaultValue: "",
        description: "URL feed DMU, mis. https://dmu.indonesiaminer.com/api/followup-reminders",
    },
    {
        key: "DMU_REMINDER_DEVICE_ID",
        defaultValue: "",
        description: "ID device WA pengirim reminder (lihat halaman Devices)",
    },
    {
        key: "DMU_REMINDER_GROUP_ID",
        defaultValue: "",
        description: "ID grup sales tujuan reminder (cek pakai !grupid di grup tsb), mis. 1203630xxxx@g.us",
    },
    {
        key: "DMU_REMINDER_MENTIONS",
        defaultValue: "",
        description: "Nomor admin/PIC yang di-tag di reminder 48h, pisahkan koma, mis. 6281234567890,6289876543210",
    },
    {
        key: "DMU_REMINDER_QUIET_HOURS",
        defaultValue: "20-8",
        description: "Jam tidak kirim (WIB), format mulai-selesai. Reminder yang tertahan dikirim setelahnya. Kosongkan = 24 jam",
    },
    // ── Daily Movement DMU (src/wa/dailyMovementService.js) ──
    // Device & API key ikut reminder DMU.
    {
        key: "DMU_MOVEMENT_ENABLED",
        defaultValue: "0",
        description: "1 = kirim rekap harian Daily Movement DMU ke grup tiap pagi, 0 = mati",
        type: "number",
    },
    {
        key: "DMU_MOVEMENT_TIME",
        defaultValue: "08:30",
        description: "Jam kirim rekap Daily Movement (WIB), format HH:MM. Isinya rekap hari kemarin",
    },
    {
        key: "DMU_MOVEMENT_GROUP_ID",
        defaultValue: "",
        description: "Grup tujuan rekap Daily Movement. Kosong = sama dengan DMU_REMINDER_GROUP_ID",
    },
    {
        key: "DMU_MOVEMENT_API_URL",
        defaultValue: "",
        description: "URL feed Daily Movement. Kosong = otomatis dari DMU_REMINDER_API_URL (…/api/daily-movement)",
    },
    // ── Reminder Lead Follow-Up sponsor DMC (src/wa/followupReminderService.js) ──
    // API key-nya di .env (DMC_REMINDER_API_KEY).
    {
        key: "DMC_REMINDER_ENABLED",
        defaultValue: "0",
        description: "1 = aktifkan reminder Lead Follow-Up sponsor DMC (H-1 deadline & overdue), 0 = mati",
        type: "number",
    },
    {
        key: "DMC_REMINDER_API_URL",
        defaultValue: "https://membership.djakarta-miningclub.com/api/lead-followup-reminders",
        description: "URL feed Lead Follow-Up DMC",
    },
    {
        key: "DMC_REMINDER_DEVICE_ID",
        defaultValue: "",
        description: "ID device WA pengirim reminder DMC (lihat halaman Devices)",
    },
    {
        key: "DMC_REMINDER_GROUP_ID",
        defaultValue: "",
        description: "ID grup tujuan reminder DMC (cek pakai !grupid), mis. 1203630xxxx@g.us",
    },
    {
        key: "DMC_REMINDER_MENTIONS",
        defaultValue: "",
        description: "Nomor admin/PIC yang di-tag saat overdue, pisahkan koma, mis. 6281234567890,6289876543210",
    },
    {
        key: "DMC_REMINDER_QUIET_HOURS",
        defaultValue: "20-8",
        description: "Jam tidak kirim reminder DMC (WIB), format mulai-selesai. Kosongkan = 24 jam",
    },
];

const TTL_MS = 30_000;
const cache = new Map(); // key -> { value, expires }

async function getSetting(key, fallback = null) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;

    try {
        const row = await AppSetting.findByPk(key);
        const value = row?.value ?? fallback;
        cache.set(key, { value, expires: now + TTL_MS });
        return value;
    } catch (err) {
        console.error(`[settings] getSetting(${key}) error:`, err.message);
        return fallback;
    }
}

async function getSettingInt(key, fallback = 0) {
    const v = await getSetting(key, null);
    if (v == null) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
}

async function setSetting(key, value, description = null) {
    await AppSetting.upsert({
        key,
        value: value == null ? null : String(value),
        description,
    });
    cache.delete(key);
}

function clearCache() {
    cache.clear();
}

/**
 * Ambil semua setting yang terdaftar di REGISTRY, dengan value dari DB
 * (atau defaultValue kalau belum pernah di-set).
 */
async function getAllRegistered() {
    const rows = await AppSetting.findAll({
        where: { key: REGISTRY.map((r) => r.key) },
    });
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });

    return REGISTRY.map((r) => ({
        key: r.key,
        value: map[r.key] ?? r.defaultValue,
        defaultValue: r.defaultValue,
        description: r.description,
        type: r.type || "string",
        isCustom: map[r.key] != null,
    }));
}

module.exports = {
    REGISTRY,
    getSetting,
    getSettingInt,
    setSetting,
    clearCache,
    getAllRegistered,
};
