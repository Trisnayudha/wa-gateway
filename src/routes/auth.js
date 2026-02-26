const express = require("express");
const c = require("../controllers/authController");

const router = express.Router();

router.get("/login", c.showLogin);
router.post("/login", c.login);
router.post("/logout", c.logout);

// bootstrap admin pertama
router.post("/bootstrap-admin", c.bootstrapAdmin);

module.exports = router;