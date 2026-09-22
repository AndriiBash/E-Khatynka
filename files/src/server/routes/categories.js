const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");
const { deleteOwnedIconFile } = require("../icons");

const router = express.Router();

function toCategory(row) {
  return { id: row.id, name: row.name, description: row.description, iconUrl: row.icon_url };
}

// Регістронезалежна перевірка на дубль назви — "Хліб" і "хліб" мають
// вважатись однією й тією самою категорією. excludeId — щоб при
// редагуванні категорія не конфліктувала сама з собою.
function findCategoryByName(name, excludeId) {
  const rows = db.prepare("SELECT * FROM categories").all();
  const normalized = name.trim().toLowerCase();
  return rows.find((r) => r.id !== excludeId && r.name.trim().toLowerCase() === normalized) || null;
}

// Публічний список — саме його показує сайдбар категорій покупцю,
// тож усе, що адмін додасть нижче через /api/admin/categories, одразу
// стає видимим і в каталозі.
router.get("/api/categories", (req, res) => {
  const rows = db.prepare("SELECT * FROM categories ORDER BY id ASC").all();
  res.json({ categories: rows.map(toCategory) });
});

router.post("/api/admin/categories", requireAdmin, (req, res) => {
  const { name, description, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву категорії (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findCategoryByName(trimmedName, null)) {
    return res.json({ ok: false, error: "Категорія з такою назвою вже існує" });
  }

  const trimmedDescription =
    typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
  const trimmedIconUrl =
    typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  const result = db
    .prepare("INSERT INTO categories (name, description, icon_url) VALUES (?, ?, ?)")
    .run(trimmedName, trimmedDescription, trimmedIconUrl);

  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, category: toCategory(row) });
});

router.put("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id категорії" });
  }

  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Категорію не знайдено" });
  }

  const { name, description, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву категорії (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findCategoryByName(trimmedName, id)) {
    return res.json({ ok: false, error: "Категорія з такою назвою вже існує" });
  }

  const trimmedDescription =
    typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
  const trimmedIconUrl =
    typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  // Іконку замінили (чи прибрали) — старий завантажений файл більше
  // нікому не потрібен, приберемо, щоб assets не засмічувались.
  if (existing.icon_url && existing.icon_url !== trimmedIconUrl) {
    deleteOwnedIconFile(existing.icon_url);
  }

  db.prepare("UPDATE categories SET name = ?, description = ?, icon_url = ? WHERE id = ?").run(
    trimmedName,
    trimmedDescription,
    trimmedIconUrl,
    id
  );

  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  res.json({ ok: true, category: toCategory(row) });
});

router.delete("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id категорії" });
  }

  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Категорію не знайдено" });
  }

  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  deleteOwnedIconFile(existing.icon_url);

  res.json({ ok: true });
});

module.exports = router;
