// ==============================
// Рух інгредієнтів (ingredient_movements) — фактичний журнал списання/
// надходження сировини, на відміну від product_recipes (це лише НОРМА
// витрати — скільки МАЄ йти на одиницю продукту). Кожен запис тут
// одразу змінює ingredients.stock_quantity — на відміну від інших
// адмін-таблиць, це не просто "рядок в БД", а реальна складська
// операція, тож editing (PUT) свідомо не робимо: помилковий запис
// краще видалити (що поверне залишок назад) і додати новий, ніж
// редагувати заднім числом.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");

const router = express.Router();

// 'restock' (закупівля/надходження) і 'adjustment' (ручне коригування,
// може бути й від'ємним) — додають на склад; 'production' (списано на
// випічку продукту) і 'waste' (брак) — списують. Той самий білий
// список, що й PAYMENT_METHOD_TYPES — не приймаємо довільний рядок від
// клієнта.
const MOVEMENT_TYPES = new Set(["restock", "production", "waste", "adjustment"]);
const MOVEMENT_DIRECTION = { restock: 1, production: -1, waste: -1, adjustment: 1 };

function toMovement(row) {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    ingredientUnit: row.ingredient_unit,
    productId: row.product_id,
    productName: row.product_name,
    movementType: row.movement_type,
    quantity: row.quantity,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

const MOVEMENT_SELECT = `
  SELECT im.id, im.ingredient_id, i.name AS ingredient_name, i.unit AS ingredient_unit,
         im.product_id, p.name AS product_name, im.movement_type, im.quantity, im.comment, im.created_at
  FROM ingredient_movements im
  JOIN ingredients i ON i.id = im.ingredient_id
  LEFT JOIN products p ON p.id = im.product_id
`;

router.get("/api/admin/ingredient-movements", requireAdmin, (req, res) => {
  const rows = db.prepare(`${MOVEMENT_SELECT} ORDER BY im.created_at DESC`).all();
  res.json({ ok: true, movements: rows.map(toMovement) });
});

router.post("/api/admin/ingredient-movements", requireAdmin, (req, res) => {
  const { ingredientId, productId, movementType, quantity, comment } = req.body || {};

  const numericIngredientId = Number(ingredientId);
  const ingredient = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(numericIngredientId);
  if (!Number.isInteger(numericIngredientId) || !ingredient) {
    return res.json({ ok: false, error: "Оберіть інгредієнт" });
  }

  if (!MOVEMENT_TYPES.has(movementType)) {
    return res.json({ ok: false, error: "Оберіть тип руху" });
  }

  const numericQuantity = Number(quantity);
  // Для 'adjustment' допускаємо будь-який ненульовий знак (сам admin
  // вирішує напрямок коригування), для решти — лише додатна величина
  // (напрямок задає сам movement_type через MOVEMENT_DIRECTION).
  if (!Number.isFinite(numericQuantity) || numericQuantity === 0) {
    return res.json({ ok: false, error: "Кількість має бути ненульовим числом" });
  }
  if (movementType !== "adjustment" && numericQuantity < 0) {
    return res.json({ ok: false, error: "Кількість має бути додатним числом" });
  }

  let numericProductId = null;
  if (productId !== null && productId !== undefined && productId !== "") {
    numericProductId = Number(productId);
    const product = db.prepare("SELECT id FROM products WHERE id = ?").get(numericProductId);
    if (!Number.isInteger(numericProductId) || !product) {
      return res.json({ ok: false, error: "Продукт не знайдено" });
    }
  }

  const trimmedComment = typeof comment === "string" && comment.trim() ? comment.trim() : null;

  const stockDelta = movementType === "adjustment" ? numericQuantity : numericQuantity * MOVEMENT_DIRECTION[movementType];
  const newStock = ingredient.stock_quantity + stockDelta;
  if (newStock < 0) {
    return res.json({
      ok: false,
      error: `Недостатньо залишку: на складі ${ingredient.stock_quantity} ${ingredient.unit}, списати намагаєтесь ${Math.abs(
        stockDelta
      )} ${ingredient.unit}.`,
    });
  }

  let movementId;
  try {
    db.exec("BEGIN");
    const result = db
      .prepare(
        `INSERT INTO ingredient_movements (ingredient_id, product_id, movement_type, quantity, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(numericIngredientId, numericProductId, movementType, numericQuantity, trimmedComment, Date.now());
    movementId = result.lastInsertRowid;
    db.prepare("UPDATE ingredients SET stock_quantity = ? WHERE id = ?").run(newStock, numericIngredientId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось зберегти рух інгредієнта:", err);
    return res.json({ ok: false, error: "Не вдалось зберегти, спробуйте ще раз" });
  }

  const row = db.prepare(`${MOVEMENT_SELECT} WHERE im.id = ?`).get(movementId);
  res.json({ ok: true, movement: toMovement(row) });
});

router.delete("/api/admin/ingredient-movements/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }

  const existing = db.prepare("SELECT * FROM ingredient_movements WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }

  // Видалення — це "цього руху не було", тож повертаємо залишок назад
  // (мінус той самий дельта, що застосували при створенні).
  const stockDelta =
    existing.movement_type === "adjustment" ? existing.quantity : existing.quantity * MOVEMENT_DIRECTION[existing.movement_type];

  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM ingredient_movements WHERE id = ?").run(id);
    db.prepare("UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE id = ?").run(
      stockDelta,
      existing.ingredient_id
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось видалити рух інгредієнта:", err);
    return res.json({ ok: false, error: "Не вдалось видалити, спробуйте ще раз" });
  }

  res.json({ ok: true });
});

module.exports = router;
