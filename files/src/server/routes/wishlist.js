const express = require("express");
const { db } = require("../db");
const { requireAdmin, requireAuth } = require("../session");

const router = express.Router();

// Список бажаного покупця — той самий toggle-паттерн, що вподобання
// (теги): POST з { productId, enabled } додає/прибирає один рядок,
// без окремого DELETE-ендпоінта. UNIQUE(user_id, product_id) в схемі
// підстраховує від дублів навіть при подвійному кліку.
router.get("/api/me/wishlist", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT product_id FROM wishlists WHERE user_id = ?").all(req.currentUser.id);
  res.json({ ok: true, productIds: rows.map((r) => r.product_id) });
});

router.post("/api/me/wishlist", requireAuth, (req, res) => {
  const { productId, enabled } = req.body || {};
  const numericProductId = Number(productId);
  if (!Number.isInteger(numericProductId)) {
    return res.json({ ok: false, error: "Некоректний товар" });
  }

  const product = db.prepare("SELECT id FROM products WHERE id = ?").get(numericProductId);
  if (!product) {
    return res.json({ ok: false, error: "Товар не знайдено" });
  }

  const userId = req.currentUser.id;
  const existing = db
    .prepare("SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?")
    .get(userId, numericProductId);

  if (enabled) {
    if (!existing) {
      db.prepare("INSERT INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, ?)").run(
        userId,
        numericProductId,
        Date.now()
      );
    }
  } else if (existing) {
    db.prepare("DELETE FROM wishlists WHERE id = ?").run(existing.id);
  }

  res.json({ ok: true });
});

// ==============================
// Адмінка — так само асиметрично, як способи оплати: товар у список
// бажаного додає сам користувач (♥ на сторінці товару), адмін лише
// переглядає й за потреби видаляє чужий запис.
// ==============================

function toAdminWishlistItem(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    productId: row.product_id,
    productName: row.product_name,
    createdAt: row.created_at,
  };
}

router.get("/api/admin/wishlists", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT w.id, w.user_id, u.full_name AS user_full_name, u.email AS user_email,
              w.product_id, p.name AS product_name, w.created_at
       FROM wishlists w
       JOIN users u ON u.id = w.user_id
       JOIN products p ON p.id = w.product_id
       ORDER BY w.created_at DESC`
    )
    .all();
  res.json({ ok: true, wishlistItems: rows.map(toAdminWishlistItem) });
});

router.delete("/api/admin/wishlists/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }
  const existing = db.prepare("SELECT id FROM wishlists WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }
  db.prepare("DELETE FROM wishlists WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
