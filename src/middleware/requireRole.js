module.exports = function requireRole(role) {
    return (req, res, next) => {
        const user = req.session?.user;
        if (!user) return res.redirect("/login");
        if (user.role !== role) return res.status(403).send("Forbidden");
        next();
    };
};