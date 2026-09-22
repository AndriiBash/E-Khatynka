// ==============================
// Кошики й предмети кошика — лише перегляд/видалення в адмінці: кошик
// наповнює сам покупець (у тому числі гість — тоді user_id NULL, а
// належність визначає session_token). Видалення кошика тягне за собою
// видалення його предметів (FK інакше блокував би сам DELETE).
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");

const router = express.Router();

function toAdminCart(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    isGuest: !row.user_id,
    itemsCount: row.items_count,
    createdAt: row.created_at,
  };
}

router.get("/api/admin/carts", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, u.full_name AS user_full_name, u.email AS user_email, c.created_at,
              (SELECT COUNT(*) FROM cart_items ci WHERE ci.cart_id = c.id) AS items_count
       FROM carts c
       LEFT JOIN users u ON u.id = c.user_id
       ORDER BY c.created_at DESC`
    )
    .all();

  // Товари кожного кошика одразу в списку (не окремим запитом при
  // відкритті прев'ю) — кошиків і позицій у них зазвичай мало, тож
  // N+1 тут дешевший за друге round-trip до сервера.
  const carts = rows.map((row) => {
    const items = db
      .prepare(
        `SELECT ci.product_id, p.name AS product_name, ci.quantity
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = ?
         ORDER BY p.name ASC`
      )
      .all(row.id)
      .map((i) => ({ productId: i.product_id, productName: i.product_name, quantity: i.quantity }));
    return { ...toAdminCart(row), items };
  });

  res.json({ ok: true, carts });
});

router.delete("/api/admin/carts/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id кошика" });
  }
  const existing = db.prepare("SELECT id FROM carts WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Кошик не знайдено" });
  }
  db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(id);
  db.prepare("DELETE FROM carts WHERE id = ?").run(id);
  res.json({ ok: true });
});

function toAdminCartItem(row) {
  return {
    id: row.id,
    cartId: row.cart_id,
    cartOwner: row.user_full_name || row.user_email || "Гість",
    cartOwnerEmail: row.user_email || null,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    addedAt: row.added_at,
  };
}

router.get("/api/admin/cart-items", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ci.id, ci.cart_id, c.user_id, u.full_name AS user_full_name, u.email AS user_email,
              ci.product_id, p.name AS product_name, ci.quantity, ci.added_at
       FROM cart_items ci
       JOIN carts c ON c.id = ci.cart_id
       LEFT JOIN users u ON u.id = c.user_id
       JOIN products p ON p.id = ci.product_id
       ORDER BY ci.added_at DESC`
    )
    .all();
  res.json({ ok: true, cartItems: rows.map(toAdminCartItem) });
});

router.delete("/api/admin/cart-items/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }
  const existing = db.prepare("SELECT id FROM cart_items WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }
  db.prepare("DELETE FROM cart_items WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
