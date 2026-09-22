const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../session");

const router = express.Router();

router.get("/api/admin/sessions", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.token, s.user_id, s.created_at, s.expires_at, u.full_name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC`
    )
    .all();
  res.json({
    ok: true,
    sessions: rows.map((r) => ({
      token: r.token,
      userId: r.user_id,
      userFullName: r.full_name,
      userEmail: r.email,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
  });
});

router.delete("/api/admin/sessions/:token", requireAdmin, (req, res) => {
  const { token } = req.params;
  const existing = db.prepare("SELECT token FROM sessions WHERE token = ?").get(token);
  if (!existing) return res.status(404).json({ ok: false, error: "Сесію не знайдено" });
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.json({ ok: true });
});

module.exports = router;
