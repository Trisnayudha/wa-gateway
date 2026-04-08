const eventController = require("../eventController");
const { getSettingInt } = require("../../db/settings");

/** @type {import('../commandHandler').CommandMeta} */
module.exports = {
    name: "detail",
    aliases: ["participant", "peserta_detail"],
    description: "Detail peserta berdasarkan codepayment",
    usage: "!detail <codepayment> [event_id]",
    scope: "both",
    category: "Event/DMC",

    async execute({ message, args }) {
        const codepayment = (args[0] || "").trim();
        const defaultId = await getSettingInt("EVENT_DEFAULT_ID", 55);
        const eventsId = args[1] ? parseInt(args[1], 10) : defaultId;

        if (!codepayment) {
            return await message.reply(
                "Format: !detail <codepayment> [event_id]\nContoh: !detail MGHEXVB 55"
            );
        }
        await eventController.handleParticipantDetail(message, { codepayment, eventsId });
    },
};
