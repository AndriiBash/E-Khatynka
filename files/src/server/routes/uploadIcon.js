// ==============================
// Завантаження іконки (категорія/тег/інгредієнт/продукт — kind у тілі
// запиту).
//
// Без multer (щоб не тягнути ще одну залежність): клієнт сам читає
// обраний файл у base64 (FileReader.readAsDataURL) і шле звичайним
// JSON-POST. Тут — декодуємо назад у Buffer і кладемо файл у
// assets/icons/<kind>/, з новим безпечним ім'ям (не довіряємо
// оригінальному імені файлу від клієнта).
// ==============================

const express = require("express");
const path = require("path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { requireAdmin } = require("../session");
const { ROOT_DIR } = require("../paths");
const { ICON_KIND_DIRS, MAX_ICON_BYTES, ICON_MIME_TO_EXT } = require("../icons");

const router = express.Router();

router.post("/api/admin/upload-icon", requireAdmin, (req, res) => {
  const { mimeType, dataBase64, kind } = req.body || {};

  const dir = ICON_KIND_DIRS[kind] || ICON_KIND_DIRS.categories; // без kind — стара поведінка (категорії)
  const ext = ICON_MIME_TO_EXT[mimeType];
  if (!ext) {
    return res.json({ ok: false, error: "Непідтримуваний формат (потрібен PNG, JPG, WEBP, GIF або SVG)" });
  }

  if (typeof dataBase64 !== "string" || dataBase64.length === 0) {
    return res.json({ ok: false, error: "Файл порожній" });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return res.json({ ok: false, error: "Не вдалось прочитати файл" });
  }

  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) {
    return res.json({ ok: false, error: "Файл завеликий (максимум 3MB)" });
  }

  const targetDir = path.join(ROOT_DIR, "assets", "icons", dir);
  fs.mkdirSync(targetDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(targetDir, filename), buffer);

  res.json({ ok: true, url: `assets/icons/${dir}/${filename}` });
});

module.exports = router;
