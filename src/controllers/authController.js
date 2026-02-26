const bcrypt = require("bcrypt");
const { User } = require("../db/models");

exports.showLogin = (req, res) => res.render("login", { error: null });

exports.login = async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user || !user.is_active) return res.render("login", { error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render("login", { error: "Invalid credentials" });

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect("/dashboard");
};

exports.logout = (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
};

// Create admin pertama (sekali aja)
exports.bootstrapAdmin = async (req, res) => {
    const { name, email, password } = req.body;

    const count = await User.count();
    if (count > 0) return res.status(400).json({ ok: false, message: "Admin already exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password_hash: hash, role: "admin", is_active: true });

    res.json({ ok: true, user: { id: user.id, email: user.email } });
};