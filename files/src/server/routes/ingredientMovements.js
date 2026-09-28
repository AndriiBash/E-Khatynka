// ==============================
// Рух інгредієнтів і продукції — журнал з чотирма операціями:
//   ingredient_purchase — закупівля інгредієнта (+ на склад інгредієнта)
//   ingredient_writeoff — списання інгредієнта (- зі складу інгредієнта)
//   product_writeoff    — списання готової продукції (- зі складу продукту)
//   production           — приготування продукції: адмін обирає продукт і
//                           кількість, а решту — які інгредієнти й
//                           скільки списати — система бере з рецепта
//                           (product_recipes) сама.
//
// "Приготування" зачіпає одразу кілька рядків (по одному на кожен
// інгредієнт з рецепта + один на приріст самого продукту) — усі вони
// позначені спільним batch_id, щоб їх можна було показати/видалити як
// ОДНУ операцію, а не купу розрізнених рядків. Решта операцій —
// одразовий рядок без batch_id.
//
// На відміну від product_recipes (це лише НОРМА витрати — план), тут —
// фактичний журнал: кожен запис одразу змінює реальний залишок
// (ingredients.stock_quantity або products.stock_quantity), а видалення
// запису повертає залишок назад.
// ==============================

const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../db");
const { requireAdmin } = require("../session");

const router = express.Router();

const MOVEMENT_TYPES = new Set(["ingredient_purchase", "ingredient_writeoff", "product_writeoff", "production"]);

function getProductRecipeForMovement(productId) {
  return db
    .prepare(
      `SELECT pr.ingredient_id, i.name AS ingredient_name, i.unit AS ingredient_unit,
              i.stock_quantity AS ingredient_stock, pr.quantity AS per_unit
       FROM product_recipes pr
       JOIN ingredients i ON i.id = pr.ingredient_id
       WHERE pr.product_id = ?`
    )
    .all(productId);
}

function toMovementRow(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
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
  SELECT im.id, im.batch_id, im.ingredient_id, i.name AS ingredient_name, i.unit AS ingredient_unit,
         im.product_id, p.name AS product_name, im.movement_type, im.quantity, im.comment, im.created_at
  FROM ingredient_movements im
  LEFT JOIN ingredients i ON i.id = im.ingredient_id
  LEFT JOIN products p ON p.id = im.product_id
`;

// GET: "Приготування" зберігається кількома рядками (спільний batch_id)
// — тут групуємо їх в один елемент відповіді з items[] (список
// списаних інгредієнтів), щоб у таблиці адмінки це виглядало як ОДНА
// операція, а не N розрізнених рядків.
router.get("/api/admin/ingredient-movements", requireAdmin, (req, res) => {
  const rows = db.prepare(`${MOVEMENT_SELECT} ORDER BY im.created_at DESC, im.id DESC`).all();

  const result = [];
  const seenBatches = new Set();

  for (const row of rows) {
    if (!row.batch_id) {
      result.push({ ...toMovementRow(row), items: null });
      continue;
    }
    if (seenBatches.has(row.batch_id)) continue;
    seenBatches.add(row.batch_id);

    const batchRows = rows.filter((r) => r.batch_id === row.batch_id);
    // Рядок з ingredient_id = NULL — це приріст самого продукту
    // (представник партії), решта — списані інгредієнти.
    const productRow = batchRows.find((r) => r.ingredient_id === null) ?? row;
    const ingredientRows = batchRows.filter((r) => r.ingredient_id !== null);

    result.push({
      ...toMovementRow(productRow),
      items: ingredientRows.map((r) => ({
        ingredientId: r.ingredient_id,
        ingredientName: r.ingredient_name,
        ingredientUnit: r.ingredient_unit,
        quantity: r.quantity,
      })),
    });
  }

  res.json({ ok: true, movements: result });
});

router.post("/api/admin/ingredient-movements", requireAdmin, (req, res) => {
  const { movementType, ingredientId, productId, quantity, comment } = req.body || {};

  if (!MOVEMENT_TYPES.has(movementType)) {
    return res.json({ ok: false, error: "Оберіть операцію" });
  }

  const numericQuantity = Number(quantity);
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    return res.json({ ok: false, error: "Кількість має бути додатним числом" });
  }

  const trimmedComment = typeof comment === "string" && comment.trim() ? comment.trim() : null;
  const now = Date.now();

  // ---- Закупівля / списання інгредієнта — один рядок, без batch_id.
  if (movementType === "ingredient_purchase" || movementType === "ingredient_writeoff") {
    const numericIngredientId = Number(ingredientId);
    const ingredient = db.prepare("SELECT * FROM ingredients WHERE id = ?").get(numericIngredientId);
    if (!Number.isInteger(numericIngredientId) || !ingredient) {
      return res.json({ ok: false, error: "Оберіть інгредієнт" });
    }

    const delta = movementType === "ingredient_purchase" ? numericQuantity : -numericQuantity;
    const newStock = ingredient.stock_quantity + delta;
    if (newStock < 0) {
      return res.json({
        ok: false,
        error: `Недостатньо залишку: на складі ${ingredient.stock_quantity} ${ingredient.unit}, списати намагаєтесь ${numericQuantity} ${ingredient.unit}.`,
      });
    }

    let movementId;
    try {
      db.exec("BEGIN");
      const result = db
        .prepare(
          `INSERT INTO ingredient_movements (ingredient_id, product_id, movement_type, quantity, comment, created_at)
           VALUES (?, NULL, ?, ?, ?, ?)`
        )
        .run(numericIngredientId, movementType, numericQuantity, trimmedComment, now);
      movementId = result.lastInsertRowid;
      db.prepare("UPDATE ingredients SET stock_quantity = ? WHERE id = ?").run(newStock, numericIngredientId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("Не вдалось зберегти рух інгредієнта:", err);
      return res.json({ ok: false, error: "Не вдалось зберегти, спробуйте ще раз" });
    }

    const row = db.prepare(`${MOVEMENT_SELECT} WHERE im.id = ?`).get(movementId);
    return res.json({ ok: true, movement: { ...toMovementRow(row), items: null } });
  }

  // ---- Списання продукції — один рядок, ingredient_id = NULL.
  if (movementType === "product_writeoff") {
    const numericProductId = Number(productId);
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(numericProductId);
    if (!Number.isInteger(numericProductId) || !product) {
      return res.json({ ok: false, error: "Оберіть продукт" });
    }

    const newStock = product.stock_quantity - numericQuantity;
    if (newStock < 0) {
      return res.json({
        ok: false,
        error: `Недостатньо залишку: на складі ${product.stock_quantity} шт, списати намагаєтесь ${numericQuantity} шт.`,
      });
    }

    let movementId;
    try {
      db.exec("BEGIN");
      const result = db
        .prepare(
          `INSERT INTO ingredient_movements (ingredient_id, product_id, movement_type, quantity, comment, created_at)
           VALUES (NULL, ?, ?, ?, ?, ?)`
        )
        .run(numericProductId, movementType, numericQuantity, trimmedComment, now);
      movementId = result.lastInsertRowid;
      db.prepare("UPDATE products SET stock_quantity = ? WHERE id = ?").run(newStock, numericProductId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("Не вдалось зберегти списання продукції:", err);
      return res.json({ ok: false, error: "Не вдалось зберегти, спробуйте ще раз" });
    }

    const row = db.prepare(`${MOVEMENT_SELECT} WHERE im.id = ?`).get(movementId);
    return res.json({ ok: true, movement: { ...toMovementRow(row), items: null } });
  }

  // ---- Приготування продукції — бере рецепт продукту й сама списує
  // потрібні інгредієнти, плюс додає готову продукцію на склад.
  const numericProductId = Number(productId);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(numericProductId);
  if (!Number.isInteger(numericProductId) || !product) {
    return res.json({ ok: false, error: "Оберіть продукт" });
  }

  const recipe = getProductRecipeForMovement(numericProductId);
  if (!recipe.length) {
    return res.json({
      ok: false,
      error: `У продукту «${product.name}» не задано рецепт — спершу додайте рецепт у картці продукту.`,
    });
  }

  // Перевіряємо ЗАРАЗ, а не по ходу списання — щоб не вийшло так, що
  // половину інгредієнтів вже списали, а на третьому не вистачило (і
  // довелось би відкочувати транзакцію все одно, але краще дати
  // адміну одразу повний список того, чого бракує).
  const shortages = [];
  for (const r of recipe) {
    const needed = r.per_unit * numericQuantity;
    if (needed > r.ingredient_stock) {
      shortages.push(`«${r.ingredient_name}»: потрібно ${needed} ${r.ingredient_unit}, є ${r.ingredient_stock} ${r.ingredient_unit}`);
    }
  }
  if (shortages.length) {
    return res.json({
      ok: false,
      error: `Не вистачає інгредієнтів для ${numericQuantity} шт «${product.name}»: ${shortages.join("; ")}.`,
    });
  }

  const batchId = crypto.randomBytes(12).toString("hex");
  let representativeId;
  try {
    db.exec("BEGIN");

    for (const r of recipe) {
      const needed = r.per_unit * numericQuantity;
      db.prepare(
        `INSERT INTO ingredient_movements (batch_id, ingredient_id, product_id, movement_type, quantity, comment, created_at)
         VALUES (?, ?, ?, 'production', ?, ?, ?)`
      ).run(batchId, r.ingredient_id, numericProductId, needed, trimmedComment, now);
      db.prepare("UPDATE ingredients SET stock_quantity = stock_quantity - ? WHERE id = ?").run(
        needed,
        r.ingredient_id
      );
    }

    const productRowResult = db
      .prepare(
        `INSERT INTO ingredient_movements (batch_id, ingredient_id, product_id, movement_type, quantity, comment, created_at)
         VALUES (?, NULL, ?, 'production', ?, ?, ?)`
      )
      .run(batchId, numericProductId, numericQuantity, trimmedComment, now);
    representativeId = productRowResult.lastInsertRowid;

    db.prepare("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?").run(
      numericQuantity,
      numericProductId
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось зберегти приготування продукції:", err);
    return res.json({ ok: false, error: "Не вдалось зберегти, спробуйте ще раз" });
  }

  const rows = db.prepare(`${MOVEMENT_SELECT} WHERE im.batch_id = ?`).all(batchId);
  const productRow = rows.find((r) => r.id === representativeId);
  const ingredientRows = rows.filter((r) => r.ingredient_id !== null);
  res.json({
    ok: true,
    movement: {
      ...toMovementRow(productRow),
      items: ingredientRows.map((r) => ({
        ingredientId: r.ingredient_id,
        ingredientName: r.ingredient_name,
        ingredientUnit: r.ingredient_unit,
        quantity: r.quantity,
      })),
    },
  });
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

  // Партія "Приготування" (спільний batch_id) видаляється й
  // відкочується ЦІЛИКОМ — інакше часткове видалення лишило б
  // неузгоджений склад (продукт прибув, а інгредієнти "не поверталися").
  const rowsToReverse = existing.batch_id
    ? db.prepare("SELECT * FROM ingredient_movements WHERE batch_id = ?").all(existing.batch_id)
    : [existing];

  try {
    db.exec("BEGIN");
    for (const row of rowsToReverse) {
      if (row.ingredient_id !== null) {
        const delta = row.movement_type === "ingredient_purchase" ? -row.quantity : row.quantity;
        db.prepare("UPDATE ingredients SET stock_quantity = stock_quantity + ? WHERE id = ?").run(
          delta,
          row.ingredient_id
        );
      } else if (row.product_id !== null) {
        const delta = row.movement_type === "product_writeoff" ? row.quantity : -row.quantity;
        db.prepare("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?").run(
          delta,
          row.product_id
        );
      }
    }
    if (existing.batch_id) {
      db.prepare("DELETE FROM ingredient_movements WHERE batch_id = ?").run(existing.batch_id);
    } else {
      db.prepare("DELETE FROM ingredient_movements WHERE id = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось видалити рух:", err);
    return res.json({ ok: false, error: "Не вдалось видалити, спробуйте ще раз" });
  }

  res.json({ ok: true });
});

module.exports = router;
