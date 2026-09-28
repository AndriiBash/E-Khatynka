// ==============================
// Збірка аналітичного звіту для адмінки: один запит → прогноз, план
// виробництва, потреба в інгредієнтах, знижки, підсумок по моделях.
// Усе рахується «на льоту» з поточного стану БД — жодних окремих
// таблиць з прогнозами не зберігаємо, тож дані не можуть застаріти.
// ==============================

const { CONFIG } = require("./config");
const { loadSalesData } = require("./data");
const { forecastProducts, summarizeModels, evaluateAggregate } = require("./forecast");
const { buildProductionPlan, buildIngredientNeeds, costModel } = require("./production");
const { analyzeDiscounts } = require("./discounts");
const { MODEL_INFO } = require("./models");
const { dowOfIndex, indexToIso, sum } = require("./stats");

function buildReport(db, now = Date.now()) {
  const cfg = CONFIG;
  const sales = loadSalesData(db, { now, historyDays: cfg.historyDays });
  const products = db.prepare("SELECT * FROM products ORDER BY name ASC").all();
  const categories = new Map(db.prepare("SELECT id, name FROM categories").all().map((c) => [c.id, c.name]));
  const modelName = new Map(MODEL_INFO.map((m) => [m.id, m.name]));

  const dates = [];
  for (let k = 1; k <= cfg.horizonDays; k++) {
    const idx = sales.todayIdx + k;
    dates.push({ iso: indexToIso(idx), dow: dowOfIndex(idx) });
  }
  const historyDates = [];
  const histLen = Math.min(28, Math.max(sales.nDays, 0));
  for (let k = histLen - 1; k >= 0; k--) historyDates.push(indexToIso(sales.lastDayIdx - k));

  const { byProduct, modelAgg } = forecastProducts(sales, products, cfg);
  const plan = buildProductionPlan(products, byProduct, sales, dates, cfg);
  const ingredients = buildIngredientNeeds(db, plan, dates);
  const discounts = analyzeDiscounts(products, byProduct, sales, cfg);

  // ---- Прогноз по товарах (для таблиці й міні-графіків)
  const perishableIds = new Set(plan.filter((p) => p.perishable).map((p) => p.productId));
  let chosenAbs = 0;
  let naiveAbs = 0;
  let actualSum = 0;
  const forecastRows = products.map((p) => {
    const f = byProduct.get(p.id);
    if (f.backtest && f.backtest.naiveAbsSum !== null) {
      chosenAbs += f.backtest.absSum;
      naiveAbs += f.backtest.naiveAbsSum;
      actualSum += f.backtest.actualSum;
    }
    return {
      productId: p.id,
      name: p.name,
      categoryId: p.category_id,
      categoryName: categories.get(p.category_id) ?? "—",
      perishable: perishableIds.has(p.id),
      price: p.price,
      stock: p.stock_quantity,
      status: f.status,
      modelId: f.modelId,
      modelName: f.modelId ? modelName.get(f.modelId) : null,
      confidence: f.confidence,
      historyDays: f.historyDays,
      wape: f.backtest?.wape ?? null,
      naiveWape: f.naiveWape,
      sigma: Math.round(f.sigma * 100) / 100,
      forecast: f.forecast.map((v) => Math.round(v * 100) / 100),
      forecastWeek: Math.round(sum(f.forecast) * 10) / 10,
      recent: f.recent,
    };
  });

  // ---- Підсумки по днях
  const totalsForecast = dates.map((_, k) => {
    let units = 0;
    let revenue = 0;
    for (const p of products) {
      const mu = byProduct.get(p.id).forecast[k] ?? 0;
      units += mu;
      revenue += mu * p.price * (1 - (p.discount_percent || 0) / 100);
    }
    return { units: Math.round(units * 10) / 10, revenue: Math.round(revenue) };
  });
  const totalsHistory = historyDates.map((_, i) => {
    const di = sales.nDays - histLen + i;
    let s = 0;
    for (const arr of sales.series.values()) s += arr[di] ?? 0;
    return s;
  });
  const produceTotals = dates.map((_, k) => {
    let units = 0;
    const parts = Object.fromEntries(cfg.dayparts.map((d) => [d.id, 0]));
    for (const item of plan) {
      if (!item.perishable) continue;
      units += item.days[k].produce;
      for (const d of cfg.dayparts) parts[d.id] += item.days[k].dayparts[d.id];
    }
    return { units, dayparts: parts };
  });

  // Сумарний ряд усього асортименту → точність прогнозу загального обсягу
  const totalSeries = new Array(sales.nDays).fill(0);
  for (const arr of sales.series.values()) arr.forEach((v, i) => (totalSeries[i] += v));
  const aggregate = evaluateAggregate(totalSeries, sales.firstDayIdx, cfg);
  const modelNameById = Object.fromEntries(MODEL_INFO.map((m) => [m.id, m.name]));

  const warnings = [];
  if (sales.nDays === 0) warnings.push("Історії продажів ще немає — прогноз порожній.");
  else if (sales.nDays < cfg.minHistoryDays) warnings.push(`Історії лише ${sales.nDays} дн. (потрібно ≥ ${cfg.minHistoryDays}) — прогноз має низьку довіру.`);

  return {
    generatedAt: now,
    meta: {
      historyDays: sales.nDays,
      firstDate: sales.nDays ? indexToIso(sales.firstDayIdx) : null,
      lastDate: sales.nDays ? indexToIso(sales.lastDayIdx) : null,
      totalUnits: sales.totalUnits,
      horizonDays: cfg.horizonDays,
      productsTotal: products.length,
      ingredientsTotal: ingredients.length,
      perishableMaxShelfDays: cfg.perishableMaxShelfDays,
      costRatio: cfg.costRatio,
      priceElasticity: cfg.priceElasticity,
      dayparts: cfg.dayparts.map((d) => ({ id: d.id, label: d.label, from: d.from, to: d.to })),
      accuracy: {
        // по окремих товарах (шумно: малі кількості)
        wape: actualSum > 0 ? chosenAbs / actualSum : null,
        naiveWape: actualSum > 0 ? naiveAbs / actualSum : null,
        // по загальному обсягу продажів за день
        totalWape: aggregate?.wape ?? null,
        totalNaiveWape: aggregate?.naiveWape ?? null,
        totalModel: aggregate ? modelNameById[aggregate.modelId] : null,
      },
      warnings,
    },
    dates,
    historyDates,
    totals: { history: totalsHistory, forecast: totalsForecast, produce: produceTotals },
    forecast: forecastRows,
    plan: plan.map((p) => ({
      ...p,
      name: products.find((x) => x.id === p.productId).name,
      stock: products.find((x) => x.id === p.productId).stock_quantity,
    })),
    ingredients,
    discounts: discounts.map((d) => ({ ...d, name: products.find((x) => x.id === d.productId).name })),
    models: summarizeModels(modelAgg),
  };
}

module.exports = { buildReport, costModel };
