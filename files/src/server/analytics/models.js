// ==============================
// Моделі прогнозування добового попиту на одиничний товар.
//
// Усі моделі мають однаковий інтерфейс:  (y, h, startIdx) => number[h]
//   y        — добові продажі (шт.), y[0] — день з індексом startIdx
//   h        — горизонт, днів
//   startIdx — індекс дня для y[0] (потрібен, щоб знати день тижня)
//
// Чому саме такий набір. Попит на випічку — короткий часовий ряд
// (десятки точок на товар) із вираженою тижневою сезонністю й багатьма
// нулями. На таких даних глибокі мережі перенавчаються, тож беремо
// компактні, інтерпретовані моделі, а кращу для КОЖНОГО товару обираємо
// емпірично — rolling-origin валідацією (backtest, див. forecast.js).
// ==============================

const { mean, solveLinear, dowOfIndex } = require("./stats");

const clamp0 = (a) => a.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));

// 1) Наївний сезонний: «як тиждень тому».
function seasonalNaive(y, h) {
  const n = y.length;
  const out = [];
  for (let k = 0; k < h; k++) out.push(y[n - 7 + (k % 7)] ?? 0);
  return out;
}

// 2) Ковзне середнє за 28 днів — базовий рівень без сезонності.
function movingAverage(y, h) {
  const m = mean(y.slice(-28));
  return new Array(h).fill(m);
}

// 3) Середнє за днем тижня зі згладжуванням до загального середнього
//    (shrinkage κ=2): якщо у понеділку лише 2–3 спостереження, оцінка не
//    «стрибає» за одним випадковим днем.
function dowMean(y, h, startIdx) {
  const n = y.length;
  const w = Math.min(n, 56);
  const base = n - w;
  const overall = mean(y.slice(base));
  const sums = new Array(7).fill(0);
  const cnt = new Array(7).fill(0);
  for (let i = base; i < n; i++) {
    const d = dowOfIndex(startIdx + i);
    sums[d] += y[i];
    cnt[d] += 1;
  }
  const kappa = 2;
  const out = [];
  for (let k = 0; k < h; k++) {
    const d = dowOfIndex(startIdx + n + k);
    out.push((sums[d] + kappa * overall) / (cnt[d] + kappa));
  }
  return out;
}

// 4) Хольта–Вінтерса: рівень + згасаючий тренд + адитивна тижнева
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

// 5) Ridge-регресія: y = β0 + β1·(тренд) + Σ β_d·[день тижня = d].
//    Це «класичний ML» варіант: ознаки — календарні, регуляризація λ
//    захищає від перенавчання на коротких рядах. Усі 7 днів тижня
//    кодуються окремими dummy-ознаками й штрафуються (тому вони
//    стягуються до ЗАГАЛЬНОГО рівня β0, а не до довільного «базового»
//    дня); вільний член і тренд не штрафуються.
function ridge(y, h, startIdx) {
  const n = y.length;
  const w = Math.min(n, 84);
  const base = n - w;
  const feat = (i) => {
    const row = [1, (i - (n - 1)) / 28];
    const d = dowOfIndex(startIdx + i);
    for (let j = 0; j < 7; j++) row.push(d === j ? 1 : 0);
    return row;
  };
  const p = 9;
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

// 6) Кростон у модифікації Сіньяхо–Бояджі (SBA) — для «переривчастого»
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

// Реєстр. Порядок = пріоритет при однаковій точності (простіші — раніше).
const MODEL_INFO = [
  { id: "seasonal_naive", name: "Сезонний наївний (t−7)", minLen: 7 },
  { id: "moving_avg", name: "Ковзне середнє (28 дн.)", minLen: 3 },
  { id: "dow_mean", name: "Середнє за днем тижня", minLen: 7 },
  { id: "croston_sba", name: "Кростон-SBA (рідкі продажі)", minLen: 7 },
  { id: "holt_winters", name: "Хольта–Вінтерса", minLen: 21 },
  { id: "ridge", name: "Ridge-регресія (тренд + день тижня)", minLen: 21 },
  { id: "ensemble", name: "Ансамбль (DOW + Хольта–Вінтерса + Ridge)", minLen: 21 },
];

// Прогнози ВСІХ застосовних моделей за один прохід (ансамбль —
// середнє трьох складових, тож рахуємо їх разом).
function forecastAll(y, h, startIdx) {
  const n = y.length;
  const out = {};
  if (n >= 3) out.moving_avg = clamp0(movingAverage(y, h));
  if (n >= 7) {
    out.seasonal_naive = clamp0(seasonalNaive(y, h));
    out.dow_mean = clamp0(dowMean(y, h, startIdx));
    out.croston_sba = clamp0(crostonSBA(y, h));
  }
  if (n >= 21) {
    out.holt_winters = clamp0(holtWinters(y, h));
    out.ridge = clamp0(ridge(y, h, startIdx));
    out.ensemble = out.dow_mean.map((_, k) => (out.dow_mean[k] + out.holt_winters[k] + out.ridge[k]) / 3);
  }
  return out;
}

module.exports = { MODEL_INFO, forecastAll };
