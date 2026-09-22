// ==============================
// Кошик покупця — на відміну від вподобань/способів оплати (requireAuth
// скрізь), кошик мають гостьовий і залогінений сценарії одразу: гість
// має право класти товари в кошик без реєстрації, а при вході кошик
// "переїжджає" на акаунт (мердж нижче). Належність визначає ЛИБО
// user_id (залогінений), ЛИБО окрема кукі ehatynka_cart із власним
// токеном (гість) — той самий підхід, що ehatynka_session для авторизації,
// просто окрема кукі, бо це не те саме поняття (гість без акаунта
// цілком може мати кошик).
//
// getOrCreateCart потрібен і routes/cart.js (сам кошик), і
// routes/orders.js (оформлення бере поточний кошик як є) — тож живе
// тут окремо, а не всередині одного з них.
// ==============================

const crypto = require("node:crypto");
const { db } = require("./db");
const { getUserByToken, COOKIE_NAME } = require("./session");

const CART_COOKIE_NAME = "ehatynka_cart";
const CART_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 24 * 180, // 180 днів — кошик гостя не має сенсу тримати як сесію логіну (30 днів)
};

function mergeCartInto(targetCartId, sourceCartId) {
  if (targetCartId === sourceCartId) return;
  const sourceItems = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(sourceCartId);
  for (const item of sourceItems) {
    const existing = db
      .prepare("SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?")
      .get(targetCartId, item.product_id);
    if (existing) {
      db.prepare("UPDATE cart_items SET quantity = ? WHERE id = ?").run(
        existing.quantity + item.quantity,
        existing.id
      );
    } else {
      db.prepare(
        "INSERT INTO cart_items (cart_id, product_id, quantity, added_at) VALUES (?, ?, ?, ?)"
      ).run(targetCartId, item.product_id, item.quantity, item.added_at);
    }
  }
  db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(sourceCartId);
  db.prepare("DELETE FROM carts WHERE id = ?").run(sourceCartId);
}

// Повертає (і за потреби створює) кошик поточного відвідувача. Якщо
// людина залогінена і водночас має "хвіст" гостьового кошика в кукі
// (клала товари до входу, потім увійшла) — тихо переливаємо гостьові
// позиції в її акаунтний кошик і прибираємо гостьову кукі.
function getOrCreateCart(req, res) {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  const guestToken = req.cookies[CART_COOKIE_NAME];

  if (user) {
    let cart = db.prepare("SELECT * FROM carts WHERE user_id = ?").get(user.id);
    if (!cart) {
      const result = db.prepare("INSERT INTO carts (user_id, created_at) VALUES (?, ?)").run(user.id, Date.now());
      cart = db.prepare("SELECT * FROM carts WHERE id = ?").get(result.lastInsertRowid);
    }

    if (guestToken) {
      const guestCart = db.prepare("SELECT * FROM carts WHERE session_token = ?").get(guestToken);
      if (guestCart) mergeCartInto(cart.id, guestCart.id);
      res.clearCookie(CART_COOKIE_NAME);
    }

    return cart;
  }

  if (guestToken) {
    const cart = db.prepare("SELECT * FROM carts WHERE session_token = ?").get(guestToken);
    if (cart) return cart;
  }

  const token = crypto.randomBytes(24).toString("hex");
  const result = db
    .prepare("INSERT INTO carts (session_token, created_at) VALUES (?, ?)")
    .run(token, Date.now());
  res.cookie(CART_COOKIE_NAME, token, CART_COOKIE_OPTS);
  return db.prepare("SELECT * FROM carts WHERE id = ?").get(result.lastInsertRowid);
}

function toPublicCartItem(row) {
  return { productId: row.product_id, quantity: row.quantity };
}

function cartItemsResponse(cartId) {
  const rows = db.prepare("SELECT * FROM cart_items WHERE cart_id = ?").all(cartId);
  return rows.map(toPublicCartItem);
}

module.exports = { CART_COOKIE_NAME, CART_COOKIE_OPTS, getOrCreateCart, cartItemsResponse };
