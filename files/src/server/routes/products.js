// ==============================
// Продукти — повний CRUD, як в інгредієнтів/категорій, плюс дві вкладені
// сутності, що редагуються ПРЯМО у формі продукту (а не окремими
// формами): рецепт (product_recipes — які інгредієнти й скільки йде на
// одиницю продукту) і теги (product_tags — просто набір tag_id). Обидва
// на update повністю переписуються (DELETE+INSERT) — простіше й
// надійніше за діффи, а кількість рядків тут завжди мала.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");
const { deleteOwnedIconFile } = require("../icons");
const { discountedPrice } = require("../pricing");

const router = express.Router();

// ---- Публічний каталог покупця (index.html/product.html) — усе, що
// адмін збереже нижче через /api/admin/products, одразу зʼявляється
// тут. На відміну від адмінського /api/admin/products, тут НЕ віддаємо
// повний рецепт (ingredient_id/quantity — внутрішня кухня, скільки
// чого йде на одиницю), лише публічно доречні поля + фінальну ціну з
// урахуванням знижки. "Склад" для покупця — це лише назви
// інгредієнтів (composition), без кількостей, так само як на етикетці
// харчового продукту.

function toPublicProduct(row) {
  const discountPercent = row.discount_percent || 0;
  const price = discountedPrice(row);
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    weight: row.weight,
    shelfLifeDays: row.shelf_life_days,
    storageConditions: row.storage_conditions,
    calories: row.calories,
    proteins: row.proteins,
    fats: row.fats,
    carbohydrates: row.carbohydrates,
    price,
    originalPrice: row.price,
    discountPercent,
    imageUrl: row.image_url,
    stockQuantity: row.stock_quantity,
    tagIds: getProductTagIds(row.id),
    composition: getProductRecipes(row.id).map((r) => r.ingredientName),
  };
}

router.get("/api/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY name ASC").all();
  res.json({ products: rows.map(toPublicProduct) });
});

// ---- Адмінка

function toProduct(row) {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    weight: row.weight,
    shelfLifeDays: row.shelf_life_days,
    storageConditions: row.storage_conditions,
    calories: row.calories,
    proteins: row.proteins,
    fats: row.fats,
    carbohydrates: row.carbohydrates,
    price: row.price,
    discountPercent: row.discount_percent,
    imageUrl: row.image_url,
    stockQuantity: row.stock_quantity,
  };
}

function getProductRecipes(productId) {
  return db
    .prepare(
      `SELECT pr.id, pr.ingredient_id, i.name AS ingredient_name, i.unit AS ingredient_unit,
              i.icon_url AS ingredient_icon_url, pr.quantity
       FROM product_recipes pr
       JOIN ingredients i ON i.id = pr.ingredient_id
       WHERE pr.product_id = ?
       ORDER BY i.name ASC`
    )
    .all(productId)
    .map((r) => ({
      id: r.id,
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      ingredientUnit: r.ingredient_unit,
      ingredientIconUrl: r.ingredient_icon_url,
      quantity: r.quantity,
    }));
}

function getProductTagIds(productId) {
  return db
    .prepare("SELECT tag_id FROM product_tags WHERE product_id = ?")
    .all(productId)
    .map((r) => r.tag_id);
}

function toProductFull(row) {
  return {
    ...toProduct(row),
    recipes: getProductRecipes(row.id),
    tagIds: getProductTagIds(row.id),
  };
}

function validateProductInput(body) {
  const {
    categoryId,
    name,
    description,
    weight,
    shelfLifeDays,
    storageConditions,
    calories,
    proteins,
    fats,
    carbohydrates,
    price,
    discountPercent,
    imageUrl,
    stockQuantity,
    recipes,
    tagIds,
  } = body || {};

  const catId = Number(categoryId);
  if (!Number.isInteger(catId) || !db.prepare("SELECT id FROM categories WHERE id = ?").get(catId)) {
    return { error: "Оберіть категорію" };
  }
  if (typeof name !== "string" || name.trim().length < 2) {
    return { error: "Введіть назву продукту (мінімум 2 символи)" };
  }
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return { error: "Ціна має бути додатним числом" };
  }
  const discountNum =
    discountPercent === undefined || discountPercent === null || discountPercent === ""
      ? 0
      : Number(discountPercent);
  if (!Number.isFinite(discountNum) || discountNum < 0 || discountNum > 100) {
    return { error: "Знижка має бути від 0 до 100%" };
  }
  const stockNum =
    stockQuantity === undefined || stockQuantity === null || stockQuantity === "" ? 0 : Number(stockQuantity);
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    return { error: "Залишок на складі має бути невідʼємним цілим числом" };
  }
  let shelfLifeNum = null;
  if (shelfLifeDays !== undefined && shelfLifeDays !== null && shelfLifeDays !== "") {
    shelfLifeNum = Number(shelfLifeDays);
    if (!Number.isInteger(shelfLifeNum) || shelfLifeNum < 0) {
      return { error: "Термін придатності має бути невідʼємним цілим числом днів" };
    }
  }
  const numOrNull = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const caloriesNum = numOrNull(calories);
  const proteinsNum = numOrNull(proteins);
  const fatsNum = numOrNull(fats);
  const carbsNum = numOrNull(carbohydrates);
  if ([caloriesNum, proteinsNum, fatsNum, carbsNum].some((n) => Number.isNaN(n))) {
    return { error: "Харчова цінність має бути невідʼємним числом" };
  }

  // Рецепт — { ingredientId, quantity }[]; той самий UNIQUE(product_id,
  // ingredient_id), що в схемі, тож дублі інгредієнта в одному рецепті
  // просто мовчки відкидаються (лишається перше входження).
  const parsedRecipes = [];
  if (Array.isArray(recipes)) {
    const seen = new Set();
    for (const r of recipes) {
      const ingId = Number(r && r.ingredientId);
      const qty = Number(r && r.quantity);
      if (!Number.isInteger(ingId) || seen.has(ingId)) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!db.prepare("SELECT id FROM ingredients WHERE id = ?").get(ingId)) continue;
      seen.add(ingId);
      parsedRecipes.push({ ingredientId: ingId, quantity: qty });
    }
  }

  const parsedTagIds = [];
  if (Array.isArray(tagIds)) {
    for (const t of tagIds) {
      const tId = Number(t);
      if (
        Number.isInteger(tId) &&
        !parsedTagIds.includes(tId) &&
        db.prepare("SELECT id FROM tags WHERE id = ?").get(tId)
      ) {
        parsedTagIds.push(tId);
      }
    }
  }

  const trimmedImageUrl = typeof imageUrl === "string" && imageUrl.trim().length > 0 ? imageUrl.trim() : null;

  return {
    categoryId: catId,
    name: name.trim(),
    description: typeof description === "string" && description.trim() ? description.trim() : null,
    weight: typeof weight === "string" && weight.trim() ? weight.trim() : null,
    shelfLifeDays: shelfLifeNum,
    storageConditions:
      typeof storageConditions === "string" && storageConditions.trim() ? storageConditions.trim() : null,
    calories: caloriesNum,
    proteins: proteinsNum,
    fats: fatsNum,
    carbohydrates: carbsNum,
    price: priceNum,
    discountPercent: discountNum,
    imageUrl: trimmedImageUrl,
    stockQuantity: stockNum,
    recipes: parsedRecipes,
    tagIds: parsedTagIds,
  };
}

function replaceProductRecipes(productId, recipes) {
  db.prepare("DELETE FROM product_recipes WHERE product_id = ?").run(productId);
  const stmt = db.prepare(
    "INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)"
  );
  for (const r of recipes) stmt.run(productId, r.ingredientId, r.quantity);
}

function replaceProductTags(productId, tagIds) {
  db.prepare("DELETE FROM product_tags WHERE product_id = ?").run(productId);
  const stmt = db.prepare("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)");
  for (const tagId of tagIds) stmt.run(productId, tagId);
}

router.get("/api/admin/products", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY name ASC").all();
  res.json({ ok: true, products: rows.map(toProductFull) });
});

router.post("/api/admin/products", requireAdmin, (req, res) => {
  const parsed = validateProductInput(req.body);
  if (parsed.error) return res.json({ ok: false, error: parsed.error });

  const result = db
    .prepare(
      `INSERT INTO products
         (category_id, name, description, weight, shelf_life_days, storage_conditions,
          calories, proteins, fats, carbohydrates, price, discount_percent, image_url, stock_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      parsed.categoryId,
      parsed.name,
      parsed.description,
      parsed.weight,
      parsed.shelfLifeDays,
      parsed.storageConditions,
      parsed.calories,
      parsed.proteins,
      parsed.fats,
      parsed.carbohydrates,
      parsed.price,
      parsed.discountPercent,
      parsed.imageUrl,
      parsed.stockQuantity
    );

  const productId = result.lastInsertRowid;
  replaceProductRecipes(productId, parsed.recipes);
  replaceProductTags(productId, parsed.tagIds);

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
  res.json({ ok: true, product: toProductFull(row) });
});

router.put("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id продукту" });
  }

  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Продукт не знайдено" });
  }

  const parsed = validateProductInput(req.body);
  if (parsed.error) return res.json({ ok: false, error: parsed.error });

  if (existing.image_url && existing.image_url !== parsed.imageUrl) {
    deleteOwnedIconFile(existing.image_url);
  }

  db.prepare(
    `UPDATE products SET
       category_id = ?, name = ?, description = ?, weight = ?, shelf_life_days = ?,
       storage_conditions = ?, calories = ?, proteins = ?, fats = ?, carbohydrates = ?,
       price = ?, discount_percent = ?, image_url = ?, stock_quantity = ?
     WHERE id = ?`
  ).run(
    parsed.categoryId,
    parsed.name,
    parsed.description,
    parsed.weight,
    parsed.shelfLifeDays,
    parsed.storageConditions,
    parsed.calories,
    parsed.proteins,
    parsed.fats,
    parsed.carbohydrates,
    parsed.price,
    parsed.discountPercent,
    parsed.imageUrl,
    parsed.stockQuantity,
    id
  );

  replaceProductRecipes(id, parsed.recipes);
  replaceProductTags(id, parsed.tagIds);

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json({ ok: true, product: toProductFull(row) });
});

router.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id продукту" });
  }

  const existing = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Продукт не знайдено" });
  }

  // product_recipes/product_tags/cart_items/wishlists без цього продукту
  // втрачають сенс — прибираємо разом з ним. order_items — навпаки,
  // історичні (уже оформлене замовлення), тож якщо продукт там
  // фігурує, видалення блокуємо, щоб не спотворити історію замовлень.
  const orderedCount = db.prepare("SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?").get(id).c;
  if (orderedCount > 0) {
    return res.status(400).json({
      ok: false,
      error: "Не можна видалити — продукт вже фігурує в оформлених замовленнях.",
    });
  }

  db.prepare("DELETE FROM product_recipes WHERE product_id = ?").run(id);
  db.prepare("DELETE FROM product_tags WHERE product_id = ?").run(id);
  db.prepare("DELETE FROM cart_items WHERE product_id = ?").run(id);
  db.prepare("DELETE FROM wishlists WHERE product_id = ?").run(id);
  db.prepare("DELETE FROM products WHERE id = ?").run(id);

  deleteOwnedIconFile(existing.image_url);

  res.json({ ok: true });
});

// ==============================
// Рецепти й теги продуктів — окремі read-only таблиці в адмінці (крім
// того, що ці ж дані редагуються прямо у формі продукту вище): суто
// для перегляду "які рецепти/теги взагалі є в системі" одним списком
// по всіх продуктах одразу, без видалення звідси — редагувати можна
// лише через сам продукт.
// ==============================

router.get("/api/admin/product-recipes", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT pr.id, pr.product_id, p.name AS product_name,
              pr.ingredient_id, i.name AS ingredient_name, i.unit AS ingredient_unit, pr.quantity
       FROM product_recipes pr
       JOIN products p ON p.id = pr.product_id
       JOIN ingredients i ON i.id = pr.ingredient_id
       ORDER BY p.name ASC, i.name ASC`
    )
    .all();
  res.json({
    ok: true,
    productRecipes: rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      ingredientUnit: r.ingredient_unit,
      quantity: r.quantity,
    })),
  });
});

router.get("/api/admin/product-tags", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT pt.id, pt.product_id, p.name AS product_name, pt.tag_id, t.name AS tag_name
       FROM product_tags pt
       JOIN products p ON p.id = pt.product_id
       JOIN tags t ON t.id = pt.tag_id
       ORDER BY p.name ASC, t.name ASC`
    )
    .all();
  res.json({
    ok: true,
    productTags: rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      tagId: r.tag_id,
      tagName: r.tag_name,
    })),
  });
});

module.exports = router;
