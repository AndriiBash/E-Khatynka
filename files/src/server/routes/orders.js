// ==============================
// Замовлення (orders/order_items) — оформлення покупцем і перегляд
// власної історії. На відміну від кошика (гість теж має право),
// замовлення можливе лише під акаунтом (requireAuth): потрібно кому
// зберегти замовлення й показати "Мої замовлення". Оформлення бере
// ПОТОЧНИЙ кошик користувача як є, рахує суму за фактичними
// (знижковими) цінами на момент покупки, списує зі stock_quantity і
// повністю очищає кошик — усе одним whole-or-nothing блоком, бо
// db.transaction в better-sqlite3 синхронний і не лишає проміжного
// стану при помилці (наприклад бракує залишку на складі десь усередині
// списку).
//
// Нижче ж — адмінський перегляд усіх замовлень одразу, зміна статусу й
// видалення (той самий "read + delete" підхід, що в кошиках/списках
// бажаного): видалення замовлення тягне за собою видалення його
// order_items (FK інакше блокував би сам DELETE) — склад НЕ
// повертається назад: адмінське видалення тут — це прибрати
// помилковий/тестовий запис із БД, а не "скасувати замовлення" як
// бізнес-операцію.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../session");
const { getOrCreateCart } = require("../cart");
const { discountedPrice } = require("../pricing");
const {
  WHOLESALE_MIN_LEAD_HOURS,
  WHOLESALE_MAX_DAYS_AHEAD,
  PICKUP_FIRST_HOUR,
  PICKUP_LAST_HOUR,
  WHOLESALE_MIN_QTY_PER_ITEM,
  WHOLESALE_DISCOUNT_TIERS,
  WHOLESALE_MAX_TOTAL_DISCOUNT,
  wholesaleVolumePercent,
  wholesaleUnitPrice,
} = require("../wholesale");

const router = express.Router();

function toOrderItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productImageUrl: row.product_image_url,
    quantity: row.quantity,
    priceAtPurchase: row.price_at_purchase,
  };
}

function getOrderItems(orderId) {
  return db
    .prepare(
      `SELECT oi.id, oi.product_id, p.name AS product_name, p.image_url AS product_image_url,
              oi.quantity, oi.price_at_purchase
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.id ASC`
    )
    .all(orderId)
    .map(toOrderItem);
}

function toOrder(row) {
  return {
    id: row.id,
    status: row.status,
    totalAmount: row.total_amount,
    deliveryAddress: row.delivery_address,
    contactPhone: row.contact_phone,
    fulfillmentType: row.fulfillment_type || "delivery",
    pickupAt: row.pickup_at ?? null,
    comment: row.comment ?? null,
    createdAt: row.created_at,
    items: getOrderItems(row.id),
  };
}

router.get("/api/orders", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.currentUser.id);
  res.json({ ok: true, orders: rows.map(toOrder) });
});

router.post("/api/orders", requireAuth, (req, res) => {
  const { deliveryAddress, contactPhone, paymentMethodId } = req.body || {};

  if (typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 5) {
    return res.json({ ok: false, error: "Вкажіть адресу доставки (мінімум 5 символів)" });
  }
  if (typeof contactPhone !== "string" || !/^\+?\d{9,13}$/.test(contactPhone.trim())) {
    return res.json({ ok: false, error: "Вкажіть коректний номер телефону" });
  }

  let paymentId = null;
  if (paymentMethodId !== null && paymentMethodId !== undefined && paymentMethodId !== "") {
    paymentId = Number(paymentMethodId);
    const method = db
      .prepare("SELECT id FROM payment_methods WHERE id = ? AND user_id = ?")
      .get(paymentId, req.currentUser.id);
    if (!method) {
      return res.json({ ok: false, error: "Спосіб оплати не знайдено" });
    }
  }

  const cart = getOrCreateCart(req, res);
  const cartItems = db
    .prepare(
      `SELECT ci.id AS cart_item_id, ci.quantity, p.id AS product_id, p.name, p.price, p.discount_percent, p.stock_quantity
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ?`
    )
    .all(cart.id);

  if (!cartItems.length) {
    return res.json({ ok: false, error: "Кошик порожній" });
  }

  const shortage = cartItems.find((i) => i.quantity > i.stock_quantity);
  if (shortage) {
    return res.json({
      ok: false,
      error: `Товару «${shortage.name}» немає в потрібній кількості на складі (доступно ${shortage.stock_quantity})`,
    });
  }

  const totalAmount =
    Math.round(cartItems.reduce((sum, i) => sum + discountedPrice(i) * i.quantity, 0) * 100) / 100;

  // DatabaseSync (node:sqlite) не має .transaction() як better-sqlite3
  // (той самий застережний коментар, що біля /api/me/payment-methods) —
  // але тут, на відміну від того місця, атомарність справді важлива
  // (гроші + списання складу одразу з кількох таблиць), тож транзакція
  // вручну через BEGIN/COMMIT/ROLLBACK, а не просто послідовні запити.
  let orderId;
  try {
    db.exec("BEGIN");

    const orderResult = db
      .prepare(
        `INSERT INTO orders (user_id, payment_method_id, status, total_amount, delivery_address, contact_phone, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(req.currentUser.id, paymentId, totalAmount, deliveryAddress.trim(), contactPhone.trim(), Date.now());
    orderId = orderResult.lastInsertRowid;

    for (const item of cartItems) {
      db.prepare(
        "INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)"
      ).run(orderId, item.product_id, item.quantity, discountedPrice(item));
      db.prepare("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?").run(
        item.quantity,
        item.product_id
      );
    }

    db.prepare("DELETE FROM cart_items WHERE cart_id = ?").run(cart.id);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось оформити замовлення:", err);
    return res.json({ ok: false, error: "Не вдалось оформити замовлення, спробуйте ще раз" });
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  res.json({ ok: true, order: toOrder(order) });
});


// Правила самовивозу для сторінки оптових замовлень (wholesale.html) —
// одне джерело правди з сервера, щоб форма й перевірка не розходились.
router.get("/api/wholesale/config", (req, res) => {
  res.json({
    ok: true,
    minLeadHours: WHOLESALE_MIN_LEAD_HOURS,
    maxDaysAhead: WHOLESALE_MAX_DAYS_AHEAD,
    firstHour: PICKUP_FIRST_HOUR,
    lastHour: PICKUP_LAST_HOUR,
    minQtyPerItem: WHOLESALE_MIN_QTY_PER_ITEM,
    discountTiers: WHOLESALE_DISCOUNT_TIERS,
    maxTotalDiscount: WHOLESALE_MAX_TOTAL_DISCOUNT,
  });
});

// ---- Оптове замовлення: оформлюється НАПЕРЕД на конкретну дату й час
// самовивозу, одним запитом зі списком позицій (кошик не
// використовується — оптовик набирає десятки позицій у таблиці, а не
// докладає по одній штуці). На відміну від роздрібного замовлення:
//   • лише для акаунтів customer_type = 'wholesale';
//   • без адреси доставки — самовивіз (fulfillment_type = 'pickup');
//   • склад не списується й залишок не перевіряється: замовлення
//     готується під вказаний час, а не береться з наявного на полиці.
router.post("/api/orders/wholesale", requireAuth, (req, res) => {
  if (req.currentUser.customer_type !== "wholesale") {
    return res.status(403).json({ ok: false, error: "Оптові замовлення доступні лише оптовим покупцям" });
  }

  const { items, pickupAt, contactPhone, comment } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.json({ ok: false, error: "Додайте до замовлення хоча б один товар" });
  }

  // Об'єднуємо дублікати productId й перевіряємо кількості.
  const quantities = new Map();
  for (const raw of items) {
    const productId = Number(raw && raw.productId);
    const quantity = Number(raw && raw.quantity);
    if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      return res.json({ ok: false, error: "Некоректна кількість у замовленні" });
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  const tooFew = [...quantities.values()].some((q) => q < WHOLESALE_MIN_QTY_PER_ITEM);
  if (tooFew) {
    return res.json({
      ok: false,
      error: `Мінімальна кількість кожного товару в оптовому замовленні — ${WHOLESALE_MIN_QTY_PER_ITEM} шт.`,
    });
  }

  const pickupTimestamp = Number(pickupAt);
  const now = Date.now();
  const minPickup = now + WHOLESALE_MIN_LEAD_HOURS * 60 * 60 * 1000;
  const maxPickup = now + WHOLESALE_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(pickupTimestamp) || pickupTimestamp < minPickup) {
    return res.json({
      ok: false,
      error: `Самовивіз можливий не раніше ніж через ${WHOLESALE_MIN_LEAD_HOURS} год після оформлення`,
    });
  }
  if (pickupTimestamp > maxPickup) {
    return res.json({ ok: false, error: `Замовляти можна не далі ніж на ${WHOLESALE_MAX_DAYS_AHEAD} днів наперед` });
  }

  const phone =
    typeof contactPhone === "string" && contactPhone.trim() ? contactPhone.trim() : req.currentUser.phone;
  if (!/^\+?\d{9,13}$/.test(phone.replace(/[\s()-]/g, ""))) {
    return res.json({ ok: false, error: "Вкажіть коректний номер телефону" });
  }

  const commentText = typeof comment === "string" ? comment.trim().slice(0, 500) : "";

  const placeholders = [...quantities.keys()].map(() => "?").join(",");
  const products = db
    .prepare(`SELECT id, name, price, discount_percent FROM products WHERE id IN (${placeholders})`)
    .all(...quantities.keys());
  if (products.length !== quantities.size) {
    return res.json({ ok: false, error: "Одного з товарів більше немає в каталозі — оновіть сторінку" });
  }

  const totalPieces = [...quantities.values()].reduce((a, b) => a + b, 0);
  const volumePercent = wholesaleVolumePercent(totalPieces);

  const subtotal =
    Math.round(products.reduce((sum, p) => sum + discountedPrice(p) * quantities.get(p.id), 0) * 100) / 100;
  const totalAmount =
    Math.round(products.reduce((sum, p) => sum + wholesaleUnitPrice(p, volumePercent) * quantities.get(p.id), 0) * 100) /
    100;

  let orderId;
  try {
    db.exec("BEGIN");

    const orderResult = db
      .prepare(
        `INSERT INTO orders (user_id, payment_method_id, status, total_amount, delivery_address, contact_phone,
                             fulfillment_type, pickup_at, comment, created_at)
         VALUES (?, NULL, 'pending', ?, 'Самовивіз', ?, 'pickup', ?, ?, ?)`
      )
      .run(req.currentUser.id, totalAmount, phone, Math.round(pickupTimestamp), commentText || null, now);
    orderId = orderResult.lastInsertRowid;

    const insertItem = db.prepare(
      "INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)"
    );
    for (const p of products) {
      insertItem.run(orderId, p.id, quantities.get(p.id), wholesaleUnitPrice(p, volumePercent));
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Не вдалось оформити оптове замовлення:", err);
    return res.json({ ok: false, error: "Не вдалось оформити замовлення, спробуйте ще раз" });
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  res.json({ ok: true, order: toOrder(order), volumeDiscountPercent: volumePercent, subtotal });
});

// ==============================
// Адмінка
// ==============================

function toAdminOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    customerType: row.user_customer_type === "wholesale" ? "wholesale" : "retail",
    status: row.status,
    totalAmount: row.total_amount,
    deliveryAddress: row.delivery_address,
    contactPhone: row.contact_phone,
    fulfillmentType: row.fulfillment_type || "delivery",
    pickupAt: row.pickup_at ?? null,
    comment: row.comment ?? null,
    createdAt: row.created_at,
    itemsCount: row.items_count,
    items: getOrderItems(row.id),
  };
}

// Легкий поллінг для сповіщень адміна про нові замовлення (без товарних
// позицій — щоб опитувати раз на 15 секунд і не ганяти зайві дані).
// afterId=0 (або відсутній) при першому виклику з такого пристрою поверне
// лише maxId, без списку "нових" — щоб при відкритті адмінки не сипались
// сповіщення про всю історію замовлень.
function toNotificationRow(row) {
  return {
    id: row.id,
    userFullName: row.user_full_name || row.user_email || "—",
    totalAmount: row.total_amount,
    itemsCount: row.items_count,
    status: row.status,
    createdAt: row.created_at,
  };
}

const NOTIFICATION_ROW_SQL = `
  SELECT o.id, o.total_amount, o.created_at, o.status,
         u.full_name AS user_full_name, u.email AS user_email,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
  FROM orders o
  JOIN users u ON u.id = o.user_id
`;

// Поллінг для сповіщень адміна про замовлення (admin-notifications.ts).
// Повертає ДВІ незалежні речі, а не одну:
//   • newOrders   — замовлення з id > afterId: лише вони показуються
//     як "жива" сплив-картка + звук (щось з'явилось прямо зараз, поки
//     адмін тут). При afterId=0 (перший візит на цьому пристрої) —
//     порожньо, щоб не сипати сповіщеннями про всю історію одразу.
//   • pendingOrders — УСІ замовлення зі статусом "Очікує обробки"
//     просто зараз, незалежно від afterId. Раніше лічильник на
//     дзвіночку рахував лише "нове з останнього разу", і через це
//     замовлення, що вже існували ДО першого відкриття адмінки
//     (типовий випадок — щойно розгорнули проєкт, а тестові
//     замовлення вже в базі), НІКОЛИ не потрапляли в бейдж чи панель —
//     виглядало так, наче сповіщення "взагалі не працюють". Бейдж і
//     панель тепер завжди показують реальний бэклог необроблених
//     замовлень, а не лише "щойно виниклі".
router.get("/api/admin/orders/notifications", requireAdmin, (req, res) => {
  const afterId = Number(req.query.afterId) || 0;
  const maxRow = db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM orders").get();
  const maxId = maxRow.maxId;

  let newOrders = [];
  if (afterId > 0 && maxId > afterId) {
    newOrders = db
      .prepare(`${NOTIFICATION_ROW_SQL} WHERE o.id > ? ORDER BY o.id ASC LIMIT 50`)
      .all(afterId)
      .map(toNotificationRow);
  }

  const pendingOrders = db
    .prepare(`${NOTIFICATION_ROW_SQL} WHERE o.status = 'pending' ORDER BY o.id DESC LIMIT 50`)
    .all()
    .map(toNotificationRow);

  res.json({ ok: true, maxId, orders: newOrders, pendingOrders });
});

router.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, u.full_name AS user_full_name, u.email AS user_email, u.customer_type AS user_customer_type,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
       FROM orders o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json({ ok: true, orders: rows.map(toAdminOrder) });
});

const ORDER_STATUSES = ["pending", "processing", "delivering", "completed", "cancelled"];

router.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id замовлення" });
  }
  const { status } = req.body || {};
  if (!ORDER_STATUSES.includes(status)) {
    return res.json({ ok: false, error: "Некоректний статус" });
  }
  const existing = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Замовлення не знайдено" });
  }
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
  const row = db
    .prepare(
      `SELECT o.*, u.full_name AS user_full_name, u.email AS user_email, u.customer_type AS user_customer_type,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`
    )
    .get(id);
  res.json({ ok: true, order: toAdminOrder(row) });
});

router.delete("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id замовлення" });
  }
  const existing = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Замовлення не знайдено" });
  }
  db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id);
  db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  res.json({ ok: true });
});

function toAdminOrderItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderOwner: row.user_full_name || row.user_email || "—",
    orderOwnerEmail: row.user_email || null,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    priceAtPurchase: row.price_at_purchase,
  };
}

router.get("/api/admin/order-items", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT oi.id, oi.order_id, u.full_name AS user_full_name, u.email AS user_email,
              oi.product_id, p.name AS product_name, oi.quantity, oi.price_at_purchase
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN users u ON u.id = o.user_id
       JOIN products p ON p.id = oi.product_id
       ORDER BY oi.id DESC`
    )
    .all();
  res.json({ ok: true, orderItems: rows.map(toAdminOrderItem) });
});

router.delete("/api/admin/order-items/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }
  const existing = db.prepare("SELECT id FROM order_items WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }
  db.prepare("DELETE FROM order_items WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
