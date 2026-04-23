require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const SequelizeStore = require("connect-session-sequelize")(session.Store);

const { sequelize } = require("./src/db/models");
const wa = require("./src/wa/manager");
const waManager = require("./src/wa/manager");
const webRoutes = require("./src/routes/web");
const authRoutes = require("./src/routes/auth");
const adminRoutes = require("./src/routes/admin");
const sendRoutes = require("./src/routes/send");
const docsRoutes = require("./src/routes/docs");
const commandRoutes = require("./src/routes/commands"); // ✅ TAMBAHAN
const settingsRoutes = require("./src/routes/settings");
const schedulerRoutes = require("./src/routes/schedulers");
const schedulerService = require("./src/wa/schedulerService");
const requireLogin = require("./src/middleware/requireLogin");
const expressLayouts = require("express-ejs-layouts");

const app = express();
let server;
let isShuttingDown = false;

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ serve static ONLY for assets
app.use("/assets", express.static(path.join(__dirname, "public/assets")));

// ===== EJS =====
app.set("view engine", "ejs");
app.set("layout", "layout"); // views/layout.ejs
app.set("views", path.join(__dirname, "views"));

// ===== SESSION (MySQL) =====
const store = new SequelizeStore({ db: sequelize });
app.use(
    session({
        secret: process.env.SESSION_SECRET || "change_me",
        resave: false,
        saveUninitialized: false,
        store,
        cookie: { maxAge: 1000 * 60 * 60 * 8 },
    })
);
store.sync();

app.use("/api", sendRoutes);
// ✅ root redirect
app.get("/", (req, res) => {
    if (!req.session?.user) return res.redirect("/login");
    return res.redirect("/dashboard");
});

app.use("/", authRoutes);
app.use("/", webRoutes);
app.use("/", commandRoutes);              // ✅ TAMBAHAN
app.use("/", settingsRoutes);
app.use("/", schedulerRoutes);
app.use("/api/admin", requireLogin, adminRoutes);
app.use("/docs", docsRoutes);

(async () => {
    try {
        await sequelize.authenticate();
        // alter:true hanya untuk development. Di production pakai migrate manual.
        const syncOpts = process.env.NODE_ENV === "production" ? {} : { alter: true };
        await sequelize.sync(syncOpts);

        await wa.initFromDb();
        await schedulerService.init(wa);

        const PORT = process.env.PORT || 3100;
        server = app.listen(PORT, () =>
            console.log(`WA Gateway running on http://localhost:${PORT}`)
        );
    } catch (err) {
        console.error("Boot error:", err);
        process.exit(1);
    }
})();

async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${signal} received. Closing WA clients...`);

    try {
        await waManager.destroyAll();

        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
    } catch (err) {
        console.error("Shutdown error:", err.message);
    } finally {
        process.exit(0);
    }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));