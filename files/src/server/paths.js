// ==============================
// Корінь проєкту (те місце, де лежать server.js, index.html,
// package.json тощо) — ОДНЕ джерело правди для всіх модулів у
// src/server/**, яким треба будувати шлях від кореня (data/, assets/,
// *.html). Просто __dirname у кожному з цих модулів вказував би на
// саму src/server/ (чи src/server/routes/), а не на корінь — звідси
// цей файл.
// ==============================

const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");

module.exports = { ROOT_DIR };
