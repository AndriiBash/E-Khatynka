const express = require("express");
const { db } = require("../db");
const { getOrCreateCart, cartItemsResponse } = require("../cart");

const router = express.Router();

router.get("/api/cart", (req, res) => {
  const cart = getOrCreateCart(req, res);
  res.json({ ok: true, items: cartItemsResponse(cart.id) });
});

router.post("/api/cart/items", (req, res) => {
  const cart = getOrCreateCart(req, res);
  const productId = Number(req.body && req.body.productId);
  if (!Number.isInteger(productId)) {
    return res.json({ ok: false, error: "Некоректний товар" });
  }
  const product = db.prepare("SELECT id, stock_quantity FROM products WHERE id = ?").get(productId);
  if (!product) {
    return res.json({ ok: false, error: "Товар не знайдено" });
  }

  const existing = db
    .prepare("SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?")
    .get(cart.id, productId);
  const currentQty = existing ? existing.quantity : 0;
  // Захист від "покласти в кошик більше, ніж є на складі" — та сама
  // умова, що на клієнті (кнопка "+" стає неактивною), але тут ще й
  // серверна перевірка, бо клієнту довіряти "на слово" не можна.
  if (currentQty >= product.stock_quantity) {
    return res.json({ ok: false, error: "Товару немає в потрібній кількості на складі", items: cartItemsResponse(cart.id) });
  }

  if (existing) {
    db.prepare("UPDATE cart_items SET quantity = ? WHERE id = ?").run(existing.quantity + 1, existing.id);
  } else {
    db.prepare(
      "INSERT INTO cart_items (cart_id, product_id, quantity, added_at) VALUES (?, ?, 1, ?)"
    ).run(cart.id, productId, Date.now());
  }

  res.json({ ok: true, items: cartItemsResponse(cart.id) });
});

router.put("/api/cart/items/:productId", (req, res) => {
  const cart = getOrCreateCart(req, res);
  const productId = Number(req.params.productId);
  const quantity = Number(req.body && req.body.quantity);

  if (!Number.isInteger(productId)) {
    return res.json({ ok: false, error: "Некоректний товар" });
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.json({ ok: false, error: "Некоректна кількість" });
  }

  if (quantity === 0) {
    db.prepare("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?").run(cart.id, productId);
  } else {
    const product = db.prepare("SELECT id, stock_quantity FROM products WHERE id = ?").get(productId);
    if (!product) {
      return res.json({ ok: false, error: "Товар не знайдено" });
    }
    // Той самий захист, що й у POST вище — незалежно від того, чи
    // товар вже був у кошику, чи щойно додається зі стану "0".
    if (quantity > product.stock_quantity) {
      return res.json({ ok: false, error: "Товару немає в потрібній кількості на складі", items: cartItemsResponse(cart.id) });
    }

    const existing = db
      .prepare("SELECT id FROM cart_items WHERE cart_id = ? AND product_id = ?")
      .get(cart.id, productId);
    if (existing) {
      db.prepare("UPDATE cart_items SET quantity = ? WHERE id = ?").run(quantity, existing.id);
    } else {
      db.prepare(
        "INSERT INTO cart_items (cart_id, product_id, quantity, added_at) VALUES (?, ?, ?, ?)"
      ).run(cart.id, productId, quantity, Date.now());
    }
  }

  res.json({ ok: true, items: cartItemsResponse(cart.id) });
});

router.delete("/api/cart/items/:productId", (req, res) => {
  const cart = getOrCreateCart(req, res);
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) {
    return res.json({ ok: false, error: "Некоректний товар" });
  }
  db.prepare("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?").run(cart.id, productId);
  res.json({ ok: true, items: cartItemsResponse(cart.id) });
});

router.delete("/api/cart", (req, res) => {
  const cart = getOrCreateCart(req, res);
  db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);
  res.json({ ok: true, items: [] });
});

module.exports = router;
