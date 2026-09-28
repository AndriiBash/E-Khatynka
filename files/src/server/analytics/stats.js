// ==============================
// Дрібні статистичні й календарні утиліти без зовнішніх залежностей.
// ==============================

const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Обернена функція стандартного нормального розподілу (алгоритм
// Acklam, похибка ~1e-9) — потрібна для z у формулі newsvendor.
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Найменше q, для якого P(X <= q) >= p, де X ~ Poisson(mu).
function poissonQuantile(mu, p) {
  if (mu <= 0) return 0;
  let k = 0;
  let term = Math.exp(-mu);
  let cdf = term;
  while (cdf < p && k < 10000) {
    k += 1;
    term *= mu / k;
    cdf += term;
  }
  return k;
}

// Розв'язок СЛАР Гауссом із вибором головного елемента (для ridge, ≤ 8×8).
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// ---- Календар. «Індекс дня» = кількість діб від 1970-01-01 за
// ЛОКАЛЬНОЮ датою сервера (пекарня живе за своїм часом, а не за UTC).
const DAY_MS = 86400000;

function dayIndex(ts) {
  const d = new Date(ts);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

function dayIndexToStartMs(idx) {
  const d = new Date(idx * DAY_MS); // UTC-північ цього індексу
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime(); // локальна північ
}

// Пн = 0 … Нд = 6. 1970-01-01 був четвергом (=3).
function dowOfIndex(idx) {
  return (((idx + 3) % 7) + 7) % 7;
}

function indexToIso(idx) {
  return new Date(idx * DAY_MS).toISOString().slice(0, 10);
}

module.exports = {
  sum,
  mean,
  median,
  normalQuantile,
  poissonQuantile,
  solveLinear,
  DAY_MS,
  dayIndex,
  dayIndexToStartMs,
  dowOfIndex,
  indexToIso,
};
