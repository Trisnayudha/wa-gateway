const { DataTypes } = require("sequelize");
const sequelize = require("./sequelize");

const Device = sequelize.define(
    "Device",
    {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false },
        status: { type: DataTypes.ENUM("DISCONNECTED", "READY"), defaultValue: "DISCONNECTED" },
        last_event: { type: DataTypes.STRING, allowNull: true },
    },
    { tableName: "devices", underscored: true }
);

const ApiKey = sequelize.define(
    "ApiKey",
    {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        device_id: { type: DataTypes.UUID, allowNull: false },
        label: { type: DataTypes.STRING, allowNull: false },
        key_hash: { type: DataTypes.STRING, allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    },
    { tableName: "api_keys", underscored: true }
);

const Message = sequelize.define(
    "Message",
    {
        id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
        device_id: { type: DataTypes.UUID, allowNull: false },
        to_number: { type: DataTypes.STRING, allowNull: false },
        text: { type: DataTypes.TEXT, allowNull: false },
        status: { type: DataTypes.ENUM("SENT", "FAILED"), allowNull: false },
        error: { type: DataTypes.TEXT, allowNull: true },
    },
    { tableName: "messages", underscored: true }
);

Device.hasMany(ApiKey, { foreignKey: "device_id" });
ApiKey.belongsTo(Device, { foreignKey: "device_id" });

Device.hasMany(Message, { foreignKey: "device_id" });
Message.belongsTo(Device, { foreignKey: "device_id" });

module.exports = { sequelize, Device, ApiKey, Message };