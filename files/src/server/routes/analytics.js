// ==============================
// Аналітика й рекомендації.
//
//   GET  /api/admin/analytics/report          — прогноз попиту, план
//        виробництва, потреба в інгредієнтах, знижки (лише адмін)
//   POST /api/admin/analytics/discounts/apply — застосувати/зняти знижку
//        на товар, запропоновану аналітикою (лише адмін)
//   GET  /api/recommendations                 — персональні підписи
//        «Ви брали раніше» / «Це беруть також інші» (лише авторизований
//        покупець; гостю тут 401 — рекомендацій для нього нема)
//
// Вся математика — в src/server/analytics/*; тут лише HTTP-обгортка.
// ==============================

const express = require("express");
const { db } = require("../db");
const { requireAdmin, requireAuth } = require("../session");
const { discountedPrice } = require("../pricing");
const { buildReport } = require("../analytics");
const { loadRecoData, buildModel, recommendForUser } = require("../analytics/recommender");

const router = express.Router();

router.get("/api/admin/analytics/report", requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, report: buildReport(db) });
  } catch (err) {
    console.error("Не вдалось побудувати аналітичний звіт:", err);
    res.status(500).json({ ok: false, error: "Не вдалось побудувати звіт" });
  }
});

router.post("/api/admin/analytics/discounts/apply", requireAdmin, (req, res) => {
  const { productId, discountPercent } = req.body || {};
  const id = Number(productId);
  const pct = Number(discountPercent);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id товару" });
  }
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return res.json({ ok: false, error: "Знижка має бути від 0 до 100%" });
  }
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) {
    return res.status(404).json({ ok: false, error: "Товар не знайдено" });
  }
  db.prepare("UPDATE products SET discount_percent = ? WHERE id = ?").run(pct, id);
  const updated = { ...product, discount_percent: pct };
  res.json({
    ok: true,
    product: { id, discountPercent: pct, price: discountedPrice(updated), originalPrice: product.price },
  });
});

// Модель будується щоразу заново: на масштабі магазину це кілька
// мілісекунд, зате «Ви брали раніше» одразу враховує щойно оформлене
// замовлення — без кешу, який довелось би інвалідувати.
router.get("/api/recommendations", requireAuth, (req, res) => {
  try {
    const model = buildModel(loadRecoData(db));
    const { bought, others } = recommendForUser(model, req.currentUser.id);
    res.json({
      ok: true,
      recommendations: [
        ...bought.map((r) => ({ productId: r.productId, reason: "bought", score: r.score })),
        ...others.map((r) => ({ productId: r.productId, reason: "others", score: r.score })),
      ],
    });
  } catch (err) {
    console.error("Не вдалось порахувати рекомендації:", err);
    res.status(500).json({ ok: false, error: "Не вдалось порахувати рекомендації" });
  }
});

module.exports = router;
