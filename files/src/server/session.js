// ==============================
// Сесії/авторизація: створення й перевірка токена сесії, кукі, та
// requireAuth/requireAdmin middleware, якими прикриті майже всі роути
// нижче.
// ==============================

const crypto = require("node:crypto");
const { db } = require("./db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,13}$/;

function toSessionUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, role: row.role };
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 днів — те саме, що maxAge кукі нижче

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) || null;
}

const COOKIE_NAME = "ehatynka_session";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: SESSION_TTL_MS, // ті самі 30 днів, що й expires_at у sessions
};

function requireAdmin(req, res, next) {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Доступ лише для адміністратора" });
  }
  req.adminUser = user;
  next();
}

function requireAuth(req, res, next) {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  if (!user) {
    return res.status(401).json({ ok: false, error: "Потрібно увійти в акаунт" });
  }
  req.currentUser = user;
  next();
}

module.exports = {
  EMAIL_RE,
  PHONE_RE,
  toSessionUser,
  SESSION_TTL_MS,
  createSession,
  getUserByToken,
  COOKIE_NAME,
  COOKIE_OPTS,
  requireAdmin,
  requireAuth,
};
