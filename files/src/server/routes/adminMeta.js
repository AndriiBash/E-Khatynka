const express = require("express");
const { db, ADMIN_TABLES, ADMIN_TABLE_TIMESTAMP_COLUMN } = require("../db");
const { requireAdmin } = require("../session");

const router = express.Router();

router.get("/api/admin/table-counts", requireAdmin, (req, res) => {
  const counts = {};
  const lastUpdated = {};
  for (const table of ADMIN_TABLES) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const col = ADMIN_TABLE_TIMESTAMP_COLUMN[table];
    lastUpdated[table] = col ? db.prepare(`SELECT MAX(${col}) AS ts FROM ${table}`).get().ts : null;
  }
  res.json({ ok: true, counts, lastUpdated });
});

module.exports = router;
