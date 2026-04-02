const { DataTypes } = require("sequelize");
const sequelize = require("./sequelize");

// ===== USER (login dashboard) =====
const User = sequelize.define("User", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.ENUM("admin", "staff"), defaultValue: "admin" },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: "users", underscored: true });

// ===== DEVICES =====
const Device = sequelize.define("Device", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("DISCONNECTED", "READY"), defaultValue: "DISCONNECTED" },
    last_event: { type: DataTypes.STRING, allowNull: true },
}, { tableName: "devices", underscored: true });

// ===== API KEYS =====
const ApiKey = sequelize.define("ApiKey", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    device_id: { type: DataTypes.UUID, allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    key_hash: { type: DataTypes.STRING, allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    api_key_plain: { type: DataTypes.STRING, allowNull: false }, // ✅ plain
    phone_number: { type: DataTypes.STRING, allowNull: true },
}, { tableName: "api_keys", underscored: true });

// ===== MESSAGES LOG =====
const Message = sequelize.define("Message", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    device_id: { type: DataTypes.UUID, allowNull: false },
    to: { type: DataTypes.STRING, allowNull: false, field: "to_number" },
    text: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM("pending", "sent", "failed"), defaultValue: "pending" },
    error: { type: DataTypes.TEXT, allowNull: true },
    message_id: { type: DataTypes.STRING, allowNull: true },
}, { tableName: "messages", underscored: true });

// ===== COMMAND CONFIG =====
const CommandConfig = sequelize.define("CommandConfig", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    // Pakai UUID agar cocok dengan devices.id (FK-safe)
    device_id: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    command_name: {
        type: DataTypes.STRING(64),
        allowNull: false,
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    cooldown_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    // Whitelist nomor — JSON array, kosong = semua boleh
    whitelist_numbers: {
        type: DataTypes.TEXT,
        defaultValue: "[]",
        get() {
            try { return JSON.parse(this.getDataValue("whitelist_numbers") || "[]"); }
            catch { return []; }
        },
        set(val) {
            this.setDataValue("whitelist_numbers", JSON.stringify(Array.isArray(val) ? val : []));
        },
    },
    // Whitelist grup — JSON array chatId @g.us, kosong = semua boleh
    whitelist_groups: {
        type: DataTypes.TEXT,
        defaultValue: "[]",
        get() {
            try { return JSON.parse(this.getDataValue("whitelist_groups") || "[]"); }
            catch { return []; }
        },
        set(val) {
            this.setDataValue("whitelist_groups", JSON.stringify(Array.isArray(val) ? val : []));
        },
    },
}, {
    tableName: "command_configs",
    timestamps: true,
    indexes: [{ unique: true, fields: ["device_id", "command_name"] }],
});

// ===== ASSOCIATIONS =====
Device.hasMany(ApiKey, { foreignKey: "device_id" });
ApiKey.belongsTo(Device, { foreignKey: "device_id" });

Device.hasMany(Message, { foreignKey: "device_id" });
Message.belongsTo(Device, { foreignKey: "device_id" });

Device.hasMany(CommandConfig, { foreignKey: "device_id", constraints: false });
CommandConfig.belongsTo(Device, { foreignKey: "device_id", constraints: false });

module.exports = { sequelize, User, Device, ApiKey, Message, CommandConfig };