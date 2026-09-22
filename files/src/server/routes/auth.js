const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../db");
const { hashPassword, verifyPassword } = require("../password");
const {
  EMAIL_RE,
  PHONE_RE,
  toSessionUser,
  createSession,
  getUserByToken,
  COOKIE_NAME,
  COOKIE_OPTS,
} = require("../session");
const { PAYMENT_METHOD_DEFAULT_LABEL } = require("../paymentMethods");

const router = express.Router();

router.post("/api/register", (req, res) => {
  const { fullName, email, phone, password } = req.body || {};

  if (typeof fullName !== "string" || fullName.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть ім'я та прізвище" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.json({ ok: false, error: "Введіть коректний email" });
  }
  if (typeof phone !== "string" || !PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
    return res.json({ ok: false, error: "Введіть коректний номер телефону" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.json({ ok: false, error: "Пароль має містити щонайменше 6 символів" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.json({ ok: false, error: "Ця email-адреса вже зареєстрована" });
  }

  const id = `u_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const trimmedName = fullName.trim();

  db.prepare(
    "INSERT INTO users (id, full_name, email, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, trimmedName, normalizedEmail, phone.trim(), hashPassword(password), Date.now());

  // Кожному новому покупцю одразу заводимо "Готівка кур'єру" основним
  // способом оплати — щоб на чекауті завжди було чим розрахуватись,
  // навіть якщо людина ще жодного разу не заходила в "Способи оплати".
  // Це не блокує подальше редагування: юзер може додати картку/Apple
  // Pay й зробити основним щось інше — тут просто розумний дефолт.
  db.prepare(
    "INSERT INTO payment_methods (user_id, type, label, is_default, created_at) VALUES (?, 'cash', ?, 1, ?)"
  ).run(id, PAYMENT_METHOD_DEFAULT_LABEL.cash, Date.now());

  const token = createSession(id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: { id, fullName: trimmedName, email: normalizedEmail, phone: phone.trim(), role: "customer" } });
});

router.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Спецкейс: логін "admin" (без email-формату) — шукаємо сідованого
  // адміна за role, а не за email (клієнт теж пропускає EMAIL_RE-перевірку
  // саме для цього значення — дивись auth-modal.ts).
  let user;
  if (normalizedEmail === "admin") {
    user = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  } else {
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.json({ ok: false, error: "Неправильний email або пароль" });
    }
    user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const token = createSession(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: toSessionUser(user) });
});

router.get("/api/session", (req, res) => {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  res.json({ user: user ? toSessionUser(user) : null });
});

router.post("/api/logout", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

module.exports = router;
