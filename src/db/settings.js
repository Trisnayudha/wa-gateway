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
