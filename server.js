require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const SequelizeStore = require("connect-session-sequelize")(session.Store);

const { sequelize } = require("./src/db/models");
const wa = require("./src/wa/manager");

const webRoutes = require("./src/routes/web");
const authRoutes = require("./src/routes/auth");
const adminRoutes = require("./src/routes/admin");
const sendRoutes = require("./src/routes/send");
const docsRoutes = require("./src/routes/docs");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ===== EJS =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ===== SESSION (MySQL) =====
const store = new SequelizeStore({ db: sequelize });
app.use(
    session({
        secret: process.env.SESSION_SECRET || "change_me",
        resave: false,
        saveUninitialized: false,
        store,
        cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 jam
    })
);

// sync session table
store.sync();

app.use("/", authRoutes);
app.use("/", webRoutes);

app.use("/api/admin", adminRoutes);
app.use("/api", sendRoutes);
app.use("/docs", docsRoutes);

(async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();

        await wa.initFromDb();

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`WA Gateway running on http://localhost:${PORT}`));
    } catch (err) {
        console.error("Boot error:", err);
        process.exit(1);
    }
})();