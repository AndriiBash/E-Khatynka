// ==============================
// Аналіз «де мало продажів» і рекомендація знижки на товари пекарні.
//
// Два незалежні сигнали ризику:
//   • overstock — залишок не встигне розійтись до кінця терміну придатності
//     при прогнозованому попиті (excess = stock − demand/день × термін);
//   • slow      — швидкість продажів товару << медіани його категорії, або
//     різко впала за тиждень.
// Розмір знижки — за сходинками від частки «зайвого» залишку, з
// обмеженням за маржею (ціна не нижча за собівартість × (1 + minMargin)).
// ==============================

const { CONFIG } = require("./config");
const { mean, median, sum } = require("./stats");
const { isPerishable, costModel } = require("./production");

const roundStep = (v, step) => Math.round(v / step) * step;
const round1 = (v) => Math.round(v * 10) / 10;

function analyzeDiscounts(products, forecasts, sales, cfg = CONFIG) {
  // Аналізуємо ВЕСЬ асортимент. Для довготривалого товару (напої, фасовка)
  // ризику «згорить» немає, тому для нього лише сигнал slow (мало продажів).
  const perishables = products;
  const n = sales.nDays;
  // Замало історії — «повільним» товар не оголошуємо (нічого порівнювати);
  // ризик залишку (overstock) рахується й без історії, бо він від запасу.
  const enoughHistory = n >= cfg.minHistoryDays;

  // ---- Метрики кожного товару
  const metrics = new Map();
  for (const p of perishables) {
    const y = sales.series.get(p.id) ?? new Array(n).fill(0);
    const first = y.findIndex((v) => v > 0);
    const lifeDays = first === -1 ? 0 : n - first;
    const window = Math.min(28, lifeDays);
    const velocity = window > 0 ? sum(y.slice(-window)) / window : 0;
    const sold7 = sum(y.slice(-7));
    const prev7 = sum(y.slice(-14, -7));
    const sold14 = sold7 + prev7;
    metrics.set(p.id, { lifeDays, velocity, sold7, prev7, sold14 });
  }

  // ---- Медіана швидкості по категорії (лише товари, що продавались) й
  //      загальна — запасний варіант, коли в категорії порівнювати ні з ким.
  const byCat = new Map();
  for (const p of perishables) {
    const m = metrics.get(p.id);
    if (m.lifeDays < 7 || m.velocity <= 0) continue;
    if (!byCat.has(p.category_id)) byCat.set(p.category_id, []);
    byCat.get(p.category_id).push(m.velocity);
  }
  const allVel = [...byCat.values()].flat();
  const globalMedian = median(allVel);
  const catMedian = (catId) => {
    const arr = byCat.get(catId);
    return arr && arr.length >= 3 ? median(arr) : globalMedian;
  };

  const rows = [];
  for (const p of perishables) {
    const m = metrics.get(p.id);
    const f = forecasts.get(p.id);
    const forecastDaily = mean(f.forecast);
    const shelf = p.shelf_life_days ?? 1;
    const stock = p.stock_quantity;
    const cm = catMedian(p.category_id);
    const relVelocity = cm > 0 ? m.velocity / cm : m.velocity > 0 ? 1 : 0;

    const daysOfCover = forecastDaily > 0.01 ? stock / forecastDaily : stock > 0 ? Infinity : 0;
    const excessUnits = isPerishable(p, cfg) ? Math.max(0, stock - forecastDaily * shelf) : 0;
    const excessShare = stock > 0 ? excessUnits / stock : 0;

    const noSales = enoughHistory && m.lifeDays === 0;
    const dropped = m.prev7 >= 7 && m.sold7 < 0.6 * m.prev7;
    const perishable = isPerishable(p, cfg);
    const isOverstock = perishable && stock > 0 && excessShare > 0.1 && excessUnits >= 1;
    const isSlow = enoughHistory && (noSales || relVelocity < cfg.slowRelativeVelocity || dropped);

    let status = "ok";
    if (isOverstock) status = "overstock";
    else if (isSlow) status = "slow";

    // ---- Розмір знижки
    let suggested = 0;
    if (status !== "ok") {
      let byOver = 0;
      if (isOverstock) byOver = excessShare < 0.25 ? 10 : excessShare < 0.5 ? 15 : excessShare < 0.75 ? 20 : 30;
      let bySlow = 0;
      if (isSlow) bySlow = noSales ? 20 : relVelocity < 0.25 ? 15 : 10;
      suggested = Math.max(byOver, bySlow);
      if (isOverstock && shelf <= 1) suggested += 5; // товар «згорає» сьогодні-завтра
      const { cost } = costModel(p, cfg);
      const maxByMargin = Math.floor((1 - (cost * (1 + cfg.minMarginOverCost)) / p.price) * 100);
      const cap = Math.min(cfg.maxDiscountPercent, maxByMargin);
      suggested = Math.min(cap, roundStep(suggested, cfg.discountStep));
    }

    const current = p.discount_percent || 0;
    let action = "none";
    if (status !== "ok") action = suggested > current ? "apply" : "keep";
    else if (current > 0) action = "remove";

    // ---- Очікуваний ефект (за припущенням цінової еластичності)
    const finalPct = action === "apply" ? suggested : action === "remove" ? 0 : current;
    const uplift = Math.pow(1 - finalPct / 100, cfg.priceElasticity) - 1;
    const newPrice = Math.round(p.price * (1 - finalPct / 100) * 100) / 100;
    // Навіть із приростом попиту від знижки залишок може не розійтись —
    // тоді чесно радимо ще й зменшити наступну партію.
    const stillExcess = Math.max(0, stock - forecastDaily * (1 + uplift) * shelf);

    rows.push({
      productId: p.id,
      perishable,
      status,
      action,
      currentDiscount: current,
      suggestedDiscount: action === "remove" ? 0 : action === "keep" ? current : suggested,
      price: p.price,
      newPrice,
      expectedUpliftPct: Math.round(uplift * 100),
      metrics: {
        stock,
        shelfLifeDays: shelf,
        sold7: m.sold7,
        sold14: m.sold14,
        velocity: round1(m.velocity),
        categoryMedian: round1(cm),
        relativeVelocity: Math.round(relVelocity * 100) / 100,
        forecastDaily: round1(forecastDaily),
        daysOfCover: Number.isFinite(daysOfCover) ? round1(daysOfCover) : null,
        excessUnits: Math.round(excessUnits),
        stillExcessUnits: Math.round(stillExcess),
        lifeDays: m.lifeDays,
      },
      reason: buildReason({ status, action, stock, shelf, daysOfCover, excessUnits, stillExcess, relVelocity, dropped, noSales, current, m }),
    });
  }

  const order = { overstock: 0, slow: 1, ok: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.action === "remove" ? 0 : 1) - (b.action === "remove" ? 0 : 1) || b.metrics.excessUnits - a.metrics.excessUnits || a.metrics.velocity - b.metrics.velocity);
  return rows;
}

function buildReason({ status, action, stock, shelf, daysOfCover, excessUnits, stillExcess, relVelocity, dropped, noSales, current, m }) {
  if (status === "ok") return current > 0 ? `Продажі в нормі — знижку ${current}% можна зняти.` : "Продажі та залишок у нормі.";
  const parts = [];
  if (status === "overstock") {
    const cover = Number.isFinite(daysOfCover) ? `${round1(daysOfCover)} дн.` : "необмежено довго";
    parts.push(`Залишок ${stock} шт. розійдеться за ${cover} при терміні придатності ${shelf} дн. — ~${Math.round(excessUnits)} шт. під загрозою списання.`);
  }
  if (noSales) parts.push("За обраний період продажів не було.");
  else if (relVelocity < CONFIG.slowRelativeVelocity) parts.push(`Продажі — лише ${Math.round(relVelocity * 100)}% від медіани категорії.`);
  if (dropped) parts.push(`За тиждень продажі впали з ${m.prev7} до ${m.sold7} шт.`);
  if (action === "keep") parts.push("Поточної знижки достатньо.");
  if (status === "overstock" && stillExcess >= 1) parts.push(`Навіть зі знижкою ~${Math.round(stillExcess)} шт. можуть залишитись — зменште наступну партію.`);
  return parts.join(" ");
}

module.exports = { analyzeDiscounts };
