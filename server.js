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
const requireLogin = require("./src/middleware/requireLogin");
const expressLayouts = require("express-ejs-layouts");

const app = express();
app.set("trust proxy", 1);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/assets", express.static(path.join(__dirname, "public/assets")));

app.set("view engine", "ejs");
app.set("layout", "layout");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);

const store = new SequelizeStore({ db: sequelize });

app.use(
    session({
        secret: process.env.SESSION_SECRET || "change_me",
        resave: false,
        saveUninitialized: false,
        store,
        cookie: {
            maxAge: 1000 * 60 * 60 * 8,
            httpOnly: true,
            sameSite: "lax",
        },
    })
);

store.sync();

app.get("/", (req, res) => {
    if (!req.session?.user) return res.redirect("/login");
    return res.redirect("/dashboard");
});

app.use("/", authRoutes);
app.use("/", webRoutes);
app.use("/api/admin", requireLogin, adminRoutes);
app.use("/api", sendRoutes);
app.use("/docs", docsRoutes);

(async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();

        await wa.initFromDb();

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, "0.0.0.0", () => {
            console.log(`WA Gateway running on http://0.0.0.0:${PORT}`);
        });
    } catch (err) {
        console.error("Boot error:", err);
        process.exit(1);
    }
})();