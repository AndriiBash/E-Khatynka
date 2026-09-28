// ==============================
// План виробництва й потреба в інгредієнтах.
//
// Скільки випікати — класична задача «продавця газет» (newsvendor) для
// швидкопсувного товару: недовипекли → втратили маржу (Cu), перевипекли
// → втратили собівартість непроданого (Co). Оптимальна кількість —
// квантиль розподілу попиту рівня критичного співвідношення
//     CR = Cu / (Cu + Co).
// ==============================

const { CONFIG, salvageFraction } = require("./config");
const { normalQuantile, poissonQuantile } = require("./stats");

function costModel(product, cfg = CONFIG) {
  const cost = product.price * cfg.costRatio;
  const underage = product.price - cost; // втрачена маржа
  const overage = cost * (1 - salvageFraction(product.shelf_life_days)); // втрата на залишку
  const criticalRatio = underage / (underage + overage);
  return { cost, underage, overage, criticalRatio };
}

// Квантиль попиту рівня CR. Для малих середніх (рідкі продажі) нормальна
// апроксимація дає безглузді від'ємні значення — беремо Пуассона.
function targetQuantity(mu, sigma, criticalRatio) {
  if (mu <= 0) return 0;
  if (mu < 10) return poissonQuantile(mu, criticalRatio);
  return Math.max(0, Math.round(mu + normalQuantile(criticalRatio) * sigma));
}

// Розподіл цілого total по частках без втрати одиниць (метод
// найбільших залишків) — щоб ранок+день+вечір давали рівно total.
function splitInteger(total, weights) {
  const wSum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || wSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / wSum);
  const base = raw.map(Math.floor);
  let rest = total - base.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k].i] += 1;
  return base;
}

// Частка продажів по частинах доби для товару в заданий день тижня:
// профіль його категорії, якщо даних досить, інакше — загальний.
function daypartShares(sales, categoryId, isWeekend, cfg = CONFIG) {
  const kind = isWeekend ? "weekend" : "weekday";
  const catProfile = sales.hourly.byCategory.get(categoryId);
  const pick = (profile) => profile[kind];
  let hours = catProfile && pick(catProfile).reduce((s, v) => s + v, 0) >= 30 ? pick(catProfile) : pick(sales.hourly.all);
  if (hours.reduce((s, v) => s + v, 0) === 0) hours = new Array(24).fill(1); // немає жодних даних — рівномірно
  return cfg.dayparts.map((dp) => {
    let s = 0;
    for (let h = dp.from; h < dp.to; h++) s += hours[h];
    return s;
  });
}

function isPerishable(product, cfg = CONFIG) {
  return product.shelf_life_days !== null && product.shelf_life_days <= cfg.perishableMaxShelfDays;
}

// Побудова плану на horizon днів.
//   products — рядки products; forecasts — Map з forecastProducts();
//   dates    — [{iso, dow}] для кожного дня горизонту.
function buildProductionPlan(products, forecasts, sales, dates, cfg = CONFIG) {
  const plan = [];
  for (const p of products) {
    const f = forecasts.get(p.id);
    const { criticalRatio } = costModel(p, cfg);
    const perishable = isPerishable(p, cfg);
    const days = dates.map((d, k) => {
      const mu = f.forecast[k] ?? 0;
      // Швидкопсувне — страховий запас за newsvendor; товар із довгим
      // терміном (напої) страхового запасу не потребує.
      const target = perishable ? targetQuantity(mu, f.sigma, criticalRatio) : Math.ceil(mu);
      // Поточний залишок зараховуємо лише проти першого дня.
      const carry = k === 0 ? p.stock_quantity : 0;
      const produce = Math.max(0, target - carry);
      const shares = daypartShares(sales, p.category_id, d.dow >= 5, cfg);
      const parts = splitInteger(produce, shares);
      return {
        date: d.iso,
        forecast: round2(mu),
        target,
        produce,
        dayparts: Object.fromEntries(cfg.dayparts.map((dp, i) => [dp.id, parts[i]])),
      };
    });
    plan.push({
      productId: p.id,
      perishable,
      criticalRatio: round2(criticalRatio),
      days,
    });
  }
  return plan;
}

// Потреба в інгредієнтах = Σ (кількість до виробництва × норма з рецепта).
function buildIngredientNeeds(db, plan, dates) {
  const recipes = db.prepare("SELECT product_id, ingredient_id, quantity FROM product_recipes").all();
  const byProduct = new Map();
  for (const r of recipes) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id).push(r);
  }
  const need = new Map(); // ingredientId -> number[dates.length]
  for (const item of plan) {
    const recs = byProduct.get(item.productId);
    if (!recs) continue;
    item.days.forEach((day, k) => {
      if (day.produce <= 0) return;
      for (const r of recs) {
        let arr = need.get(r.ingredient_id);
        if (!arr) {
          arr = new Array(dates.length).fill(0);
          need.set(r.ingredient_id, arr);
        }
        arr[k] += day.produce * r.quantity;
      }
    });
  }

  const usedInRecipes = new Set(recipes.map((r) => r.ingredient_id));
  const ingredients = db.prepare("SELECT id, name, unit, stock_quantity, low_stock_threshold, icon_url FROM ingredients").all();
  const rows = [];
  for (const ing of ingredients) {
    // Інгредієнти без рецептур теж показуємо (потреба 0) — щоб склад було видно повністю.
    const perDay = need.get(ing.id) ?? new Array(dates.length).fill(0);
    const used = need.has(ing.id) || usedInRecipes.has(ing.id);
    const tomorrow = perDay[0];
    const week = perDay.reduce((s, v) => s + v, 0);
    const shortageTomorrow = Math.max(0, tomorrow - ing.stock_quantity);
    const shortageWeek = Math.max(0, week - ing.stock_quantity);
    const belowThreshold = ing.low_stock_threshold != null && ing.stock_quantity <= ing.low_stock_threshold;
    let status = "ok";
    if (!used) status = "unused";
    else if (shortageTomorrow > 1e-9) status = "critical";
    else if (shortageWeek > 1e-9) status = "low";
    else if (belowThreshold) status = "low";
    rows.push({
      ingredientId: ing.id,
      name: ing.name,
      unit: ing.unit,
      iconUrl: ing.icon_url,
      stock: ing.stock_quantity,
      perDay: perDay.map((v) => roundQty(v, ing.unit)),
      needTomorrow: roundQty(tomorrow, ing.unit),
      needWeek: roundQty(week, ing.unit),
      shortageTomorrow: ceilQty(shortageTomorrow, ing.unit),
      shortageWeek: ceilQty(shortageWeek, ing.unit),
      status,
      lowStockThreshold: ing.low_stock_threshold ?? null,
      belowThreshold,
      usedInRecipes: used,
    });
  }
  rows.sort((a, b) => (a.status === "unused") - (b.status === "unused") || b.shortageWeek - a.shortageWeek || b.needWeek - a.needWeek);
  return rows;
}

const round2 = (v) => Math.round(v * 100) / 100;

// Дискретні одиниці (шт, г) — цілі; кг/л — до грама/мілілітра.
function roundQty(v, unit) {
  return unit === "шт" || unit === "г" ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000;
}
function ceilQty(v, unit) {
  if (v <= 0) return 0;
  return unit === "шт" || unit === "г" ? Math.ceil(v - 1e-9) : Math.ceil(v * 10 - 1e-9) / 10;
}

module.exports = { costModel, targetQuantity, splitInteger, isPerishable, buildProductionPlan, buildIngredientNeeds };
