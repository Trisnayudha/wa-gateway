// Pool koneksi terpisah untuk database DMC (membership)
// Set env: DMC_DB_HOST, DMC_DB_PORT, DMC_DB_USER, DMC_DB_PASS, DMC_DB_NAME
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
    host: process.env.DMC_DB_HOST,
    port: Number(process.env.DMC_DB_PORT || 3306),
    user: process.env.DMC_DB_USER,
    password: process.env.DMC_DB_PASS,
    database: process.env.DMC_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
});

module.exports = pool;
