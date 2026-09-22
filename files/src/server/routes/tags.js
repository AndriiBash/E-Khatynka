// ==============================
// Теги — та сама механіка, що й категорії (без опису: за
// ER-діаграмою в тегів лише name + icon_url).
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");
const { deleteOwnedIconFile } = require("../icons");

const router = express.Router();

function toTag(row) {
  return { id: row.id, name: row.name, iconUrl: row.icon_url };
}

function findTagByName(name, excludeId) {
  const rows = db.prepare("SELECT * FROM tags").all();
  const normalized = name.trim().toLowerCase();
  return rows.find((r) => r.id !== excludeId && r.name.trim().toLowerCase() === normalized) || null;
}

// Публічний список — знадобиться на вітрині (фільтр за тегами,
// позначки на картці продукту тощо).
router.get("/api/tags", (req, res) => {
  const rows = db.prepare("SELECT * FROM tags ORDER BY id ASC").all();
  res.json({ tags: rows.map(toTag) });
});

router.post("/api/admin/tags", requireAdmin, (req, res) => {
  const { name, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву тегу (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findTagByName(trimmedName, null)) {
    return res.json({ ok: false, error: "Тег з такою назвою вже існує" });
  }

  const trimmedIconUrl = typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  const result = db.prepare("INSERT INTO tags (name, icon_url) VALUES (?, ?)").run(trimmedName, trimmedIconUrl);

  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, tag: toTag(row) });
});

router.put("/api/admin/tags/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id тегу" });
  }

  const existing = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Тег не знайдено" });
  }

  const { name, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву тегу (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findTagByName(trimmedName, id)) {
    return res.json({ ok: false, error: "Тег з такою назвою вже існує" });
  }

  const trimmedIconUrl = typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  if (existing.icon_url && existing.icon_url !== trimmedIconUrl) {
    deleteOwnedIconFile(existing.icon_url);
  }

  db.prepare("UPDATE tags SET name = ?, icon_url = ? WHERE id = ?").run(trimmedName, trimmedIconUrl, id);

  const row = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  res.json({ ok: true, tag: toTag(row) });
});

router.delete("/api/admin/tags/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id тегу" });
  }

  const existing = db.prepare("SELECT * FROM tags WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Тег не знайдено" });
  }

  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  deleteOwnedIconFile(existing.icon_url);

  res.json({ ok: true });
});

module.exports = router;
