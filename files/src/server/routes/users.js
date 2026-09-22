const express = require("express");
const { db } = require("../db");
const { requireAdmin, PHONE_RE } = require("../session");

const router = express.Router();

// Список користувачів для адмінки — і для таблиці "Користувачі", і для
// селектора у формі вподобань. Без password_hash. orderCount і
// totalSpent — агрегати по orders (усі статуси, свого поля
// "скасовано" в схемі поки нема) для картки перегляду користувача.
router.get("/api/admin/users", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
              COUNT(o.id) AS order_count, COALESCE(SUM(o.total_amount), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       GROUP BY u.id
       ORDER BY u.full_name ASC`
    )
    .all();
  res.json({
    ok: true,
    users: rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      createdAt: r.created_at,
      orderCount: r.order_count,
      totalSpent: r.total_spent,
    })),
  });
});

// Редагування користувача з адмінки — навмисно лише імʼя й телефон.
// Email не чіпаємо: він слугує логіном (і вже має UNIQUE-обмеження),
// тож його зміна — це окрема історія з підтвердженням пошти, а не
// просто поле у формі. Роль/пароль тут теж не міняємо.
router.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { fullName, phone } = req.body || {};

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ ok: false, error: "Користувача не знайдено" });

  if (typeof fullName !== "string" || fullName.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть ім'я та прізвище" });
  }
  if (typeof phone !== "string" || !PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
    return res.json({ ok: false, error: "Введіть коректний номер телефону" });
  }

  db.prepare("UPDATE users SET full_name = ?, phone = ? WHERE id = ?").run(
    fullName.trim(),
    phone.trim(),
    id
  );

  const row = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
              COUNT(o.id) AS order_count, COALESCE(SUM(o.total_amount), 0) AS total_spent
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.id = ?
       GROUP BY u.id`
    )
    .get(id);

  res.json({
    ok: true,
    user: {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      createdAt: row.created_at,
      orderCount: row.order_count,
      totalSpent: row.total_spent,
    },
  });
});

// Видалення користувача — власний рахунок видалити не можна (щоб адмін
// сам собі не перекрив доступ), і якщо є повʼязані записи (замовлення,
// кошики тощо — FK без ON DELETE CASCADE), видалення відхиляється з
// зрозумілою причиною замість падіння в 500.
router.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (id === req.adminUser.id) {
    return res.status(400).json({ ok: false, error: "Не можна видалити самого себе" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ ok: false, error: "Користувача не знайдено" });

  try {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  } catch {
    return res.status(400).json({
      ok: false,
      error: "Не можна видалити — є повʼязані записи (замовлення, кошики тощо).",
    });
  }
  res.json({ ok: true });
});

module.exports = router;
