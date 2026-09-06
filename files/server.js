// ==============================
// Локальний backend для Є-Хатинки: Express + вбудований у Node.js
// модуль node:sqlite (жодних зовнішніх БД чи нативних залежностей, які
// треба було б компілювати під платформу).
//
// Вимагає Node.js 22.5+ (node:sqlite з'явився саме там, як
// experimental-модуль — про це буде попередження в консолі, це
// нормально). Перевірити свою версію: `node -v`.
//
// Запуск:
//   npm install
//   npm run build   (компілює src/ts/*.ts у dist/js — фронтенд)
//   npm start        (піднімає цей сервер на http://localhost:3000)
// ==============================

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "ehatynka.db");

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ---- Паролі: node:crypto scrypt, вбудований у Node, без npm-залежностей.
// Це справжнє, криптографічно стійке хешування (на відміну від
// попереднього fakeHash для localStorage-мока) — з випадковою сіллю на
// кожен пароль і timing-safe порівнянням при перевірці.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,13}$/;

function toSessionUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"
  ).run(token, userId, Date.now());
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  return db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) || null;
}

const COOKIE_NAME = "ehatynka_session";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 днів
};

const app = express();
app.use(express.json());
app.use(cookieParser());

// ВАЖЛИВО: НЕ роздаємо весь __dirname як статику — там лежить
// data/ehatynka.db (хеші паролів!), server.js, package.json тощо.
// Явно віддаємо лише те, що дійсно потрібне браузеру.
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
// Прямий /index.html теж має працювати — інакше будь-яке відносне
// посилання href="index.html" (лого, 404-сторінка тощо), відкрите поки
// адреса в браузері вже "/", веде на /index.html, а такого маршруту не
// було — 404. Віддаємо той самий файл.
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/404.html", (req, res) => res.sendFile(path.join(__dirname, "404.html")));
app.get("/product.html", (req, res) => res.sendFile(path.join(__dirname, "product.html")));
app.use("/dist", express.static(path.join(__dirname, "dist")));
app.use("/src/css", express.static(path.join(__dirname, "src", "css")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.post("/api/register", (req, res) => {
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

  const token = createSession(id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: { id, fullName: trimmedName, email: normalizedEmail } });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email) || typeof password !== "string") {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const token = createSession(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: toSessionUser(user) });
});

app.get("/api/session", (req, res) => {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  res.json({ user: user ? toSessionUser(user) : null });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Для будь-якого невідомого шляху без розширення файлу (тобто це не
// запит до /dist, /src, /assets тощо) — 404.html, той самий підхід, що
// й на статичному хостингу.
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "404.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Є-Хатинка: http://localhost:${PORT}`);
  console.log(`База даних: ${DB_PATH}`);
});
