// ==============================
// Моделі прогнозування добового попиту на одиничний товар.
//
// Усі моделі мають однаковий інтерфейс:  (y, h, startIdx) => number[h]
//   y        — добові продажі (шт.), y[0] — день з індексом startIdx
//   h        — горизонт, днів
//   startIdx — індекс дня для y[0] (потрібен, щоб знати день тижня)
//
// Набір: Кростон-SBA, Хольта–Вінтерса, Ridge-регресія й ансамбль цих
// трьох із ДИНАМІЧНИМИ вагами. Попит на випічку — короткий ряд (десятки
// точок) із тижневою сезонністю й нулями, тож беремо компактні моделі;
// кращу для КОЖНОГО товару обираємо rolling-origin валідацією
// (backtest, див. forecast.js).
// ==============================

const { mean, solveLinear, dowOfIndex } = require("./stats");
const { calendarFlags } = require("./calendar");
const { CONFIG } = require("./config");

const clamp0 = (a) => a.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));

// 1) Хольта–Вінтерса: рівень + згасаючий тренд + адитивна тижнева
//    сезонність. Параметри α, β, γ — перебір по сітці за SSE одноденного
//    прогнозу на навчальній вибірці.
function hwRun(y, alpha, beta, gamma, phi) {
  const m = 7;
  const n = y.length;
  let level = mean(y.slice(0, m));
  let trend = (mean(y.slice(m, 2 * m)) - level) / m;
  const season = [];
  for (let i = 0; i < m; i++) season.push(y[i] - level);
  let sse = 0;
  for (let t = m; t < n; t++) {
    const si = t % m;
    const yhat = level + phi * trend + season[si];
    const e = y[t] - yhat;
    sse += e * e;
    const prevLevel = level;
    level = alpha * (y[t] - season[si]) + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
    season[si] = gamma * (y[t] - level) + (1 - gamma) * season[si];
  }
  return { sse, level, trend, season };
}

function holtWinters(y, h) {
  const n = y.length;
  const phi = 0.9;
  let best = null;
  for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5]) {
    for (const beta of [0, 0.02, 0.05, 0.1]) {
      for (const gamma of [0.05, 0.1, 0.2, 0.4]) {
        const r = hwRun(y, alpha, beta, gamma, phi);
        if (!best || r.sse < best.sse) best = r;
      }
    }
  }
  const out = [];
  let damp = 0;
  for (let k = 0; k < h; k++) {
    damp += Math.pow(phi, k + 1);
    out.push(best.level + damp * best.trend + best.season[(n + k) % 7]);
  }
  return out;
}

// 2) Ridge-регресія: y = β0 + β1·(тренд) + Σ β_d·[день тижня = d]
//    + β_h·[свято] + β_p·[переддень свята].
//    Усі 7 днів тижня й обидві святкові ознаки штрафуються (L2, λ), тож
//    стягуються до ЗАГАЛЬНОГО рівня β0: якщо свят у навчальному вікні
//    було 1–2, ефект не «стрибає»; якщо жодного — коефіцієнт = 0.
//    Вільний член і тренд не штрафуються.
function ridge(y, h, startIdx) {
  const n = y.length;
  const w = Math.min(n, 84);
  const base = n - w;
  const p = 11; // 1 + тренд + 7 днів + свято + переддень
  const feat = (i) => {
    const row = [1, (i - (n - 1)) / 28];
    const d = dowOfIndex(startIdx + i);
    for (let j = 0; j < 7; j++) row.push(d === j ? 1 : 0);
    row.push(...calendarFlags(startIdx + i));
    return row;
  };
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = base; i < n; i++) {
    const x = feat(i);
    for (let a = 0; a < p; a++) {
      Xty[a] += x[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += x[a] * x[b];
    }
  }
  const lambda = 1;
  for (let a = 2; a < p; a++) XtX[a][a] += lambda;
  const beta = solveLinear(XtX, Xty);
  if (!beta) return new Array(h).fill(mean(y));
  const out = [];
  for (let k = 0; k < h; k++) {
    const x = feat(n + k);
    out.push(x.reduce((s, v, i) => s + v * beta[i], 0));
  }
  return out;
}

// 3) Кростон у модифікації Сіньяхо–Бояджі (SBA) — для «переривчастого»
//    попиту, коли більшість днів продажів нуль. Оцінює окремо розмір
//    попиту й інтервал між ненульовими днями.
function crostonSBA(y, h) {
  const alpha = 0.1;
  let z = null;
  let p = null;
  let q = 1;
  for (const v of y) {
    if (v > 0) {
      if (z === null) {
        z = v;
        p = q;
      } else {
        z = z + alpha * (v - z);
        p = p + alpha * (q - p);
      }
      q = 1;
    } else {
      q += 1;
    }
  }
  if (z === null) return new Array(h).fill(0);
  return new Array(h).fill(((1 - alpha / 2) * z) / p);
}

// Реєстр. Порядок = пріоритет при однаковій точності.
const MODEL_INFO = [
  { id: "croston_sba", name: "Кростон-SBA", minLen: 1 },
  { id: "holt_winters", name: "Хольта–Вінтерса", minLen: 21 },
  { id: "ridge", name: "Ridge-регресія", minLen: 21 },
  { id: "ensemble", name: "Ансамбль", minLen: 21 },
];

// Прогнози трьох складових ансамблю (без самого ансамблю).
function componentForecasts(y, h, startIdx) {
  const n = y.length;
  const out = {};
  if (n >= 1) out.croston_sba = clamp0(crostonSBA(y, h));
  if (n >= 21) {
    out.holt_winters = clamp0(holtWinters(y, h));
    out.ridge = clamp0(ridge(y, h, startIdx));
  }
  return out;
}

const COMPONENT_IDS = ["holt_winters", "ridge", "croston_sba"];

// Динамічні ваги ансамблю для КОНКРЕТНОГО ряду: складові прогнозують
// останні тижні навчальної вибірки (навчаючись лише на даних ДО них),
// вага ∝ 1/MAE². Потім змішуємо з рівними вагами, щоб одна модель не
// забирала все через випадковий тиждень. Тестові дані сюди не потрапляють
// — y тут уже лише навчальна частина.
function ensembleWeights(y, startIdx) {
  const { innerFolds, innerHorizon, equalMix } = CONFIG.ensemble;
  const n = y.length;
  const absErr = Object.fromEntries(COMPONENT_IDS.map((id) => [id, 0]));
  let folds = 0;
  for (let f = innerFolds; f >= 1; f--) {
    const origin = n - f * innerHorizon;
    if (origin < 21) continue;
    const preds = componentForecasts(y.slice(0, origin), innerHorizon, startIdx);
    for (let k = 0; k < innerHorizon; k++) {
      for (const id of COMPONENT_IDS) absErr[id] += Math.abs(preds[id][k] - y[origin + k]);
    }
    folds += 1;
  }
  const equal = 1 / COMPONENT_IDS.length;
  if (!folds) return Object.fromEntries(COMPONENT_IDS.map((id) => [id, equal]));

  const cnt = folds * innerHorizon;
  const inv = {};
  let total = 0;
  for (const id of COMPONENT_IDS) {
    const mae = absErr[id] / cnt;
    inv[id] = 1 / Math.max(mae, 0.05) ** 2;
    total += inv[id];
  }
  const w = {};
  for (const id of COMPONENT_IDS) w[id] = (1 - equalMix) * (inv[id] / total) + equalMix * equal;
  return w;
}

// Прогнози ВСІХ застосовних моделей за один прохід.
// Повертає { forecasts: {id: number[h]}, weights: {id: w} | null }.
function forecastAll(y, h, startIdx) {
  const forecasts = componentForecasts(y, h, startIdx);
  let weights = null;
  if (y.length >= 21) {
    weights = ensembleWeights(y, startIdx);
    forecasts.ensemble = forecasts.croston_sba.map((_, k) =>
      COMPONENT_IDS.reduce((s, id) => s + weights[id] * forecasts[id][k], 0)
    );
  }
  return { forecasts, weights };
}

module.exports = { MODEL_INFO, forecastAll };
