const eventController = require("../eventController");
const { getSettingInt } = require("../../db/settings");

/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "peserta",
    aliases: ["participants"],
    description: "List peserta event by package",
    usage: "!peserta [event_id]",
    scope: "both",
    category: "Event/DMC",

    async execute({ message, args }) {
        const defaultId = await getSettingInt("EVENT_DEFAULT_ID", 55);
        const eventsId = args[0] ? parseInt(args[0], 10) : defaultId;
        if (!Number.isFinite(eventsId)) {
            return await message.reply(`Format: !peserta [event_id]  (default: ${defaultId})`);
        }
        await eventController.handleListParticipants(message, { eventsId });
    },
};
