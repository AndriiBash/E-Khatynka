// ==============================
// Інгредієнти (склад) — адмін керує повним CRUD: сировина не привʼязана
// до конкретного продукту напряму (це product_recipes), тут лише
// довідник "що взагалі є на складі" з одиницею виміру й залишком.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");
const { deleteOwnedIconFile } = require("../icons");

const router = express.Router();

function toIngredient(row) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    iconUrl: row.icon_url,
  };
}

function findIngredientByName(name, excludeId) {
  const rows = db.prepare("SELECT * FROM ingredients").all();
  const normalized = name.trim().toLowerCase();
  return rows.find((r) => r.id !== excludeId && r.name.trim().toLowerCase() === normalized) || null;
}

// Спільна перевірка полів для POST і PUT нижче — щоб не тримати дві
// трохи різні копії тих самих if'ів.
// Той самий фіксований список, що в <select> адмінки (admin.html) —
// сервер не довіряє клієнту "на слово": навіть якщо хтось надішле
// довільний запит напряму в API (не через форму), одиниця виміру все
// одно має бути з цього переліку.
const INGREDIENT_UNITS = new Set(["кг", "г", "л", "мл", "шт", "уп", "пачка", "банка"]);

function validateIngredientInput(body) {
  const { name, unit, stockQuantity, lowStockThreshold, iconUrl } = body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return { error: "Введіть назву інгредієнта (мінімум 2 символи)" };
  }
  if (typeof unit !== "string" || !INGREDIENT_UNITS.has(unit.trim())) {
    return { error: "Оберіть одиницю виміру зі списку" };
  }
  const qty = Number(stockQuantity);
  if (!Number.isFinite(qty) || qty < 0) {
    return { error: "Залишок на складі має бути невідʼємним числом" };
  }
  let threshold = null;
  if (lowStockThreshold !== null && lowStockThreshold !== undefined && lowStockThreshold !== "") {
    threshold = Number(lowStockThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      return { error: "Поріг низького залишку має бути невідʼємним числом" };
    }
  }

  const trimmedIconUrl = typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  return {
    name: name.trim(),
    unit: unit.trim(),
    stockQuantity: qty,
    lowStockThreshold: threshold,
    iconUrl: trimmedIconUrl,
  };
}

router.get("/api/admin/ingredients", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM ingredients ORDER BY name ASC").all();
  res.json({ ok: true, ingredients: rows.map(toIngredient) });
});

router.post("/api/admin/ingredients", requireAdmin, (req, res) => {
  const parsed = validateIngredientInput(req.body);
  if (parsed.error) return res.json({ ok: false, error: parsed.error });

  if (findIngredientByName(parsed.name, null)) {
    return res.json({ ok: false, error: "Інгредієнт з такою назвою вже існує" });
  }

  const result = db
    .prepare(
      "INSERT INTO ingredients (name, unit, stock_quantity, low_stock_threshold, icon_url) VALUES (?, ?, ?, ?, ?)"
    )
    .run(parsed.name, parsed.unit, parsed.stockQuantity, parsed.lowStockThreshold, parsed.iconUrl);

  const row = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, ingredient: toIngredient(row) });
});

router.put("/api/admin/ingredients/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id інгредієнта" });
  }

  const existing = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Інгредієнт не знайдено" });
  }

  const parsed = validateIngredientInput(req.body);
  if (parsed.error) return res.json({ ok: false, error: parsed.error });

  if (findIngredientByName(parsed.name, id)) {
    return res.json({ ok: false, error: "Інгредієнт з такою назвою вже існує" });
  }

  // Та сама механіка прибирання файлу старої іконки, що й у
  // категорій/тегів (deleteOwnedIconFile) — якщо іконку замінили чи
  // прибрали, старий файл в assets/icons/ingredients/ більше нікому
  // не потрібен.
  if (existing.icon_url && existing.icon_url !== parsed.iconUrl) {
    deleteOwnedIconFile(existing.icon_url);
  }

  db.prepare(
    "UPDATE ingredients SET name = ?, unit = ?, stock_quantity = ?, low_stock_threshold = ?, icon_url = ? WHERE id = ?"
  ).run(parsed.name, parsed.unit, parsed.stockQuantity, parsed.lowStockThreshold, parsed.iconUrl, id);

  const row = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(id);
  res.json({ ok: true, ingredient: toIngredient(row) });
});

router.delete("/api/admin/ingredients/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id інгредієнта" });
  }

  const existing = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Інгредієнт не знайдено" });
  }

  try {
    db.prepare("DELETE FROM ingredients WHERE id = ?").run(id);
  } catch {
    return res.status(400).json({
      ok: false,
      error: "Не можна видалити — інгредієнт використовується в рецептах або русі складу.",
    });
  }

  deleteOwnedIconFile(existing.icon_url);

  res.json({ ok: true });
});

module.exports = router;
