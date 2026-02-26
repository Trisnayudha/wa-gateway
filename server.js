require("dotenv").config();

const express = require("express");
const path = require("path");

const { sequelize } = require("./src/db/models");
const wa = require("./src/wa/manager");

const adminRoutes = require("./src/routes/admin");
const sendRoutes = require("./src/routes/send");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/admin", adminRoutes);
app.use("/api", sendRoutes);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

(async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync(); // auto create tables

        await wa.initFromDb(); // init WA client for all saved devices

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`WA Gateway running on http://localhost:${PORT}`));
    } catch (err) {
        console.error("Boot error:", err);
        process.exit(1);
    }
})();