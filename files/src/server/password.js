// ==============================
// Паролі: node:crypto scrypt, вбудований у Node, без npm-залежностей.
// Це справжнє, криптографічно стійке хешування (на відміну від
// попереднього fakeHash для localStorage-мока) — з випадковою сіллю на
// кожен пароль і timing-safe порівнянням при перевірці.
// ==============================

const crypto = require("node:crypto");

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

module.exports = { hashPassword, verifyPassword };
