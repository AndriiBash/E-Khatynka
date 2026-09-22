// ==============================
// Вподобання користувачів (user_tag_preferences) — теги, продукти з
// якими користувач ХОЧЕ бачити в каталозі й рекомендаціях (улюблені
// теги, а не "заборонені" — важливо не переплутати напрямок і в
// текстах на клієнті). Адмін тут бачить і керує усіма записами; сам
// покупець керує лише своїми — через /api/me/tag-preferences нижче.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin, requireAuth } = require("../session");

const router = express.Router();

function toUserTagPreference(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    tagId: row.tag_id,
    tagName: row.tag_name,
    tagIconUrl: row.tag_icon_url,
    createdAt: row.created_at,
  };
}

const USER_TAG_PREFERENCE_SELECT = `
  SELECT
    p.id AS id,
    p.user_id AS user_id,
    u.full_name AS user_full_name,
    u.email AS user_email,
    p.tag_id AS tag_id,
    t.name AS tag_name,
    t.icon_url AS tag_icon_url,
    p.created_at AS created_at
  FROM user_tag_preferences p
  JOIN users u ON u.id = p.user_id
  JOIN tags t ON t.id = p.tag_id
`;

router.get("/api/admin/user-tag-preferences", requireAdmin, (req, res) => {
  const rows = db.prepare(`${USER_TAG_PREFERENCE_SELECT} ORDER BY p.id DESC`).all();
  res.json({ ok: true, preferences: rows.map(toUserTagPreference) });
});

router.post("/api/admin/user-tag-preferences", requireAdmin, (req, res) => {
  const { userId, tagId } = req.body || {};

  if (typeof userId !== "string" || userId.trim().length === 0) {
    return res.json({ ok: false, error: "Оберіть користувача" });
  }
  const numericTagId = Number(tagId);
  if (!Number.isInteger(numericTagId)) {
    return res.json({ ok: false, error: "Оберіть тег" });
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.json({ ok: false, error: "Користувача не знайдено" });
  }
  const tag = db.prepare("SELECT id FROM tags WHERE id = ?").get(numericTagId);
  if (!tag) {
    return res.json({ ok: false, error: "Тег не знайдено" });
  }

  const dup = db
    .prepare("SELECT id FROM user_tag_preferences WHERE user_id = ? AND tag_id = ?")
    .get(userId, numericTagId);
  if (dup) {
    return res.json({ ok: false, error: "У цього користувача вже є таке вподобання" });
  }

  const result = db
    .prepare("INSERT INTO user_tag_preferences (user_id, tag_id, created_at) VALUES (?, ?, ?)")
    .run(userId, numericTagId, Date.now());

  const row = db.prepare(`${USER_TAG_PREFERENCE_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
  res.json({ ok: true, preference: toUserTagPreference(row) });
});

router.delete("/api/admin/user-tag-preferences/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }

  const existing = db.prepare("SELECT id FROM user_tag_preferences WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }

  db.prepare("DELETE FROM user_tag_preferences WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.put("/api/admin/user-tag-preferences/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id" });
  }

  const existing = db.prepare("SELECT * FROM user_tag_preferences WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Запис не знайдено" });
  }

  const { userId, tagId } = req.body || {};

  if (typeof userId !== "string" || userId.trim().length === 0) {
    return res.json({ ok: false, error: "Оберіть користувача" });
  }
  const numericTagId = Number(tagId);
  if (!Number.isInteger(numericTagId)) {
    return res.json({ ok: false, error: "Оберіть тег" });
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.json({ ok: false, error: "Користувача не знайдено" });
  }
  const tag = db.prepare("SELECT id FROM tags WHERE id = ?").get(numericTagId);
  if (!tag) {
    return res.json({ ok: false, error: "Тег не знайдено" });
  }

  const dup = db
    .prepare("SELECT id FROM user_tag_preferences WHERE user_id = ? AND tag_id = ? AND id != ?")
    .get(userId, numericTagId, id);
  if (dup) {
    return res.json({ ok: false, error: "У цього користувача вже є таке вподобання" });
  }

  db.prepare("UPDATE user_tag_preferences SET user_id = ?, tag_id = ? WHERE id = ?").run(userId, numericTagId, id);

  const row = db.prepare(`${USER_TAG_PREFERENCE_SELECT} WHERE p.id = ?`).get(id);
  res.json({ ok: true, preference: toUserTagPreference(row) });
});

// ---- "Мої вподобання" — покупець керує власними тегами сам, з меню
// користувача (див. Мої вподобання в user-menu.ts). На відміну від
// адмінських ручок вище, тут немає id окремого запису в тілі запиту —
// лише tagId і прапорець "увімкнено/вимкнено", решту (чи є вже такий
// рядок) сервер визначає сам по user_id із сесії.

router.get("/api/me/tag-preferences", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT tag_id FROM user_tag_preferences WHERE user_id = ?")
    .all(req.currentUser.id);
  res.json({ ok: true, tagIds: rows.map((r) => r.tag_id) });
});

router.post("/api/me/tag-preferences", requireAuth, (req, res) => {
  const { tagId, enabled } = req.body || {};
  const numericTagId = Number(tagId);
  if (!Number.isInteger(numericTagId)) {
    return res.json({ ok: false, error: "Некоректний тег" });
  }

  const tag = db.prepare("SELECT id FROM tags WHERE id = ?").get(numericTagId);
  if (!tag) {
    return res.json({ ok: false, error: "Тег не знайдено" });
  }

  const userId = req.currentUser.id;
  const existing = db
    .prepare("SELECT id FROM user_tag_preferences WHERE user_id = ? AND tag_id = ?")
    .get(userId, numericTagId);

  if (enabled) {
    if (!existing) {
      db.prepare("INSERT INTO user_tag_preferences (user_id, tag_id, created_at) VALUES (?, ?, ?)").run(
        userId,
        numericTagId,
        Date.now()
      );
    }
  } else if (existing) {
    db.prepare("DELETE FROM user_tag_preferences WHERE id = ?").run(existing.id);
  }

  res.json({ ok: true });
});

module.exports = router;
