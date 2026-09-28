// ==============================
// Прогноз попиту по кожному товару:
//   1) усі моделі з models.js прогнозують тестові вікна (rolling-origin);
//   2) для товару обираємо модель із найменшою MAE (з пріоритетом
//      ансамблю при майже однаковій точності);
//   3) обрана модель, донавчена на всій історії, дає прогноз на
//      horizon днів; RMSE backtest'у стає σ для страхового запасу.
// ==============================

const { CONFIG } = require("./config");
const { MODEL_INFO, forecastAll } = require("./models");
const { mean, sum } = require("./stats");

// Rolling-origin: тестові вікна — останні `folds` відрізків по
// `horizon` днів; на кожному навчаємось лише на даних ДО вікна, тож
// «підглядання в майбутнє» немає.
function backtest(y, startIdx, folds, horizon, minTrain) {
  const n = y.length;
  const origins = [];
  for (let f = folds; f >= 1; f--) {
    const o = n - f * horizon;
    if (o >= minTrain) origins.push({ origin: o, len: horizon });
  }
  if (!origins.length) {
    // Дуже короткий ряд: одне вікно з третини історії.
    const len = Math.min(horizon, Math.floor(n / 3));
    if (len >= 2 && n - len >= 7) origins.push({ origin: n - len, len });
  }
  if (!origins.length) return null;

  const stats = {};
  let actualSum = 0;
  for (const { origin, len } of origins) {
    const train = y.slice(0, origin);
    const preds = forecastAll(train, len, startIdx);
    for (let k = 0; k < len; k++) {
      const actual = y[origin + k];
      actualSum += actual;
      for (const id of Object.keys(preds)) {
        const e = preds[id][k] - actual;
        const st = (stats[id] ||= { abs: 0, sq: 0, bias: 0, cnt: 0 });
        st.abs += Math.abs(e);
        st.sq += e * e;
        st.bias += e;
        st.cnt += 1;
      }
    }
  }
  const perModel = {};
  for (const id of Object.keys(stats)) {
    const st = stats[id];
    perModel[id] = {
      mae: st.abs / st.cnt,
      rmse: Math.sqrt(st.sq / st.cnt),
      bias: st.bias / st.cnt,
      absSum: st.abs,
      points: st.cnt,
      wape: actualSum > 0 ? st.abs / actualSum : null,
    };
  }
  return { perModel, actualSum, points: Object.values(stats)[0]?.cnt ?? 0 };
}

function chooseModel(perModel) {
  // Сезонний наївний — лише еталон для порівняння: один випадковий
  // тиждень тому надто шумний, щоб прогнозувати за ним.
  const ids = MODEL_INFO.map((m) => m.id).filter((id) => perModel[id] && id !== "seasonal_naive");
  let best = null;
  for (const id of ids) if (!best || perModel[id].mae < perModel[best].mae - 1e-9) best = id;
  // Комбінація прогнозів стабільніша за окрему модель: якщо ансамбль
  // поступається найкращій менш ніж на 3% — віддаємо перевагу йому.
  if (perModel.ensemble && best !== "ensemble" && perModel.ensemble.mae <= perModel[best].mae * 1.03 + 1e-9) {
    return "ensemble";
  }
  return best;
}

// products: [{id, ...}]; повертає Map<productId, ProductForecast>.
function forecastProducts(sales, products, cfg = CONFIG) {
  const horizon = cfg.horizonDays;
  const stepsAhead = horizon + 1; // +1: перший крок — це «сьогодні», його відкидаємо
  const out = new Map();
  const modelAgg = {}; // агрегат по моделях: Σ|e| й Σy для WAPE по всьому асортименту

  for (const p of products) {
    const full = sales.series.get(p.id);
    if (!full || !full.some((v) => v > 0)) {
      out.set(p.id, emptyForecast(horizon, "no_sales", sales.nDays));
      continue;
    }
    // «Життя» товару починається з першого продажу.
    const first = full.findIndex((v) => v > 0);
    const y = full.slice(first);
    const startIdx = sales.firstDayIdx + first;
    const n = y.length;

    const bt = backtest(y, startIdx, cfg.backtestFolds, cfg.backtestHorizon, 14);
    let modelId;
    if (bt) modelId = chooseModel(bt.perModel);
    else modelId = n >= 7 ? "dow_mean" : "moving_avg";

    const preds = forecastAll(y, stepsAhead, startIdx);
    if (!preds[modelId]) modelId = preds.dow_mean ? "dow_mean" : "moving_avg";
    const mu = preds[modelId].slice(1); // з «завтра»

    const chosenStats = bt?.perModel[modelId];
    const sigma = chosenStats ? chosenStats.rmse : Math.sqrt(Math.max(mean(mu), 0.25));

    if (bt) {
      for (const id of Object.keys(bt.perModel)) {
        const a = (modelAgg[id] ||= { absSum: 0, actualSum: 0, chosen: 0 });
        a.absSum += bt.perModel[id].absSum;
        a.actualSum += bt.actualSum;
      }
      if (modelAgg[modelId]) modelAgg[modelId].chosen += 1;
    }

    let confidence = "high";
    if (n < 21 || !bt) confidence = "low";
    else if (chosenStats.wape === null || chosenStats.wape > 0.6) confidence = "low";
    else if (n < 42 || chosenStats.wape > 0.35) confidence = "medium";

    out.set(p.id, {
      status: "ok",
      modelId,
      historyDays: n,
      forecast: mu,
      sigma,
      confidence,
      backtest: chosenStats
        ? {
            wape: chosenStats.wape,
            mae: chosenStats.mae,
            rmse: chosenStats.rmse,
            bias: chosenStats.bias,
            points: chosenStats.points,
            absSum: chosenStats.absSum,
            actualSum: bt.actualSum,
            naiveAbsSum: bt.perModel.seasonal_naive?.absSum ?? null,
          }
        : null,
      // Наївний сезонний — еталон, з яким порівнюємо вибрану модель.
      naiveWape: bt?.perModel.seasonal_naive?.wape ?? null,
      recent: full.slice(-28),
    });
  }

  return { byProduct: out, modelAgg };
}

// Точність на рівні ВСЬОГО асортименту (сума продажів за день): шум
// окремих товарів взаємно гаситься, тому WAPE тут суттєво нижчий, ніж по
// окремих позиціях — саме ця цифра відповідає на «наскільки можна довіряти
// прогнозу загального обсягу».
function evaluateAggregate(totalSeries, startIdx, cfg = CONFIG) {
  if (totalSeries.length < 21) return null;
  const bt = backtest(totalSeries, startIdx, cfg.backtestFolds, cfg.backtestHorizon, 14);
  if (!bt) return null;
  const modelId = chooseModel(bt.perModel);
  return {
    modelId,
    wape: bt.perModel[modelId].wape,
    naiveWape: bt.perModel.seasonal_naive?.wape ?? null,
  };
}

function emptyForecast(horizon, status, nDays) {
  return {
    status,
    modelId: null,
    historyDays: 0,
    forecast: new Array(horizon).fill(0),
    sigma: 0,
    confidence: "low",
    backtest: null,
    naiveWape: null,
    recent: new Array(Math.min(28, nDays)).fill(0),
  };
}

// Зведення по моделях для вкладки «Моделі»: WAPE на всьому асортименті
// й скільки разів модель була обрана.
function summarizeModels(modelAgg) {
  return MODEL_INFO.filter((m) => modelAgg[m.id]).map((m) => {
    const a = modelAgg[m.id];
    return {
      id: m.id,
      name: m.name,
      wape: a.actualSum > 0 ? a.absSum / a.actualSum : null,
      chosenCount: a.chosen,
    };
  });
}

module.exports = { forecastProducts, summarizeModels, evaluateAggregate, backtest, chooseModel };
