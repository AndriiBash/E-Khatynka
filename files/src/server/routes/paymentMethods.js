// ==============================
// Способи оплати — навмисно асиметричний CRUD: додає СВІЙ спосіб лише
// сам користувач (з попапу в шапці сайту, "Спосіб оплати" — не
// адмінка), а адмін у своїй таблиці тільки дивиться список усіх і за
// потреби видаляє (шахрайський/помилковий запис) — але не створює й
// не редагує чужі картки/гаманці за когось.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin, requireAuth } = require("../session");
const { PAYMENT_METHOD_TYPES, PAYMENT_METHOD_DEFAULT_LABEL, toAdminPaymentMethod } = require("../paymentMethods");

const router = express.Router();

router.get("/api/admin/payment-methods", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT pm.id, pm.user_id, u.full_name AS user_full_name, u.email AS user_email,
              pm.type, pm.label, pm.is_default, pm.created_at
       FROM payment_methods pm
       JOIN users u ON u.id = pm.user_id
       ORDER BY pm.created_at DESC`
    )
    .all();
  res.json({ ok: true, paymentMethods: rows.map(toAdminPaymentMethod) });
});

router.delete("/api/admin/payment-methods/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id способу оплати" });
  }

  const existing = db.prepare("SELECT id FROM payment_methods WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Спосіб оплати не знайдено" });
  }

  try {
    db.prepare("DELETE FROM payment_methods WHERE id = ?").run(id);
  } catch {
    return res.status(400).json({
      ok: false,
      error: "Не можна видалити — спосіб оплати повʼязаний із замовленнями.",
    });
  }

  res.json({ ok: true });
});

// Покупець додає СВІЙ спосіб оплати — з попапу в меню користувача.
// provider_token тут навчальна заглушка (не інтегровано зі справжнім
// платіжним провайдером): для карток лишаємо тільки останні 4 цифри в
// label, самого номера картки чи токена ніде не зберігаємо.
router.get("/api/me/payment-methods", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, type, label, is_default, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC"
    )
    .all(req.currentUser.id);
  res.json({
    ok: true,
    paymentMethods: rows.map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label,
      isDefault: !!row.is_default,
      createdAt: row.created_at,
    })),
  });
});

router.post("/api/me/payment-methods", requireAuth, (req, res) => {
  const { type, cardDigits, customLabel, isDefault } = req.body || {};

  if (typeof type !== "string" || !PAYMENT_METHOD_TYPES.has(type)) {
    return res.json({ ok: false, error: "Оберіть спосіб оплати" });
  }

  const trimmedDigits = typeof cardDigits === "string" ? cardDigits.trim() : "";
  if (type === "card" && !/^\d{4}$/.test(trimmedDigits)) {
    return res.json({ ok: false, error: "Введіть останні 4 цифри картки" });
  }

  // Власна назва — необов'язкова для будь-якого типу оплати. Для
  // картки її додаємо ДО автоматичного "•••• 1234" (а не замінюємо
  // його), бо останні цифри — це і є найкорисніша частина підпису.
  const trimmedCustomLabel =
    typeof customLabel === "string" && customLabel.trim().length > 0 ? customLabel.trim().slice(0, 40) : null;

  let finalLabel;
  if (type === "card") {
    finalLabel = trimmedCustomLabel
      ? `${trimmedCustomLabel} (•••• ${trimmedDigits})`
      : `Картка •••• ${trimmedDigits}`;
  } else {
    finalLabel = trimmedCustomLabel || PAYMENT_METHOD_DEFAULT_LABEL[type] || type;
  }

  const userId = req.currentUser.id;

  // Максимум 3 способи оплати на юзера — і не більше одного "готівкою",
  // бо в готівки нема жодного поля, яке б відрізняло один запис від
  // іншого (не картка з різними цифрами) — другий такий запис був би
  // просто дублікатом першого.
  const existingCount = db
    .prepare("SELECT COUNT(*) AS count FROM payment_methods WHERE user_id = ?")
    .get(userId).count;
  if (existingCount >= 3) {
    return res.json({ ok: false, error: "Можна додати не більше 3 способів оплати" });
  }
  if (type === "cash") {
    const hasCash = db
      .prepare("SELECT id FROM payment_methods WHERE user_id = ? AND type = 'cash'")
      .get(userId);
    if (hasCash) {
      return res.json({ ok: false, error: "Оплата готівкою вже додана" });
    }
  }

  const shouldBeDefault = !!isDefault;

  // DatabaseSync (node:sqlite) не має .transaction() як better-sqlite3
  // — тут це і не критично: два прості UPDATE/INSERT поспіль без
  // конкурентного доступу (локальний SQLite-файл, один процес).
  if (shouldBeDefault) {
    db.prepare("UPDATE payment_methods SET is_default = 0 WHERE user_id = ?").run(userId);
  }
  const result = db
    .prepare(
      "INSERT INTO payment_methods (user_id, type, label, is_default, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(userId, type, finalLabel, shouldBeDefault ? 1 : 0, Date.now());

  const row = db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(result.lastInsertRowid);
  res.json({
    ok: true,
    paymentMethod: {
      id: row.id,
      type: row.type,
      label: row.label,
      isDefault: !!row.is_default,
      createdAt: row.created_at,
    },
  });
});

router.delete("/api/me/payment-methods/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id способу оплати" });
  }

  // Власник перевіряється явно (WHERE user_id = ?), а не лише
  // існування рядка — інакше покупець міг би видалити чужий спосіб
  // оплати, підставивши довільний id.
  const existing = db
    .prepare("SELECT id FROM payment_methods WHERE id = ? AND user_id = ?")
    .get(id, req.currentUser.id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Спосіб оплати не знайдено" });
  }

  db.prepare("DELETE FROM payment_methods WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;
