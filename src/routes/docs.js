const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openapi = require("../../docs/openapi.json");

const router = express.Router();

router.use("/", swaggerUi.serve);
router.get("/", swaggerUi.setup(openapi));

module.exports = router;