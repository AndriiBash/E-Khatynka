// ==============================
// Вибірка історії продажів із SQLite і перетворення у часові ряди.
// Єдине місце в аналітиці, яке ходить у БД за замовленнями.
// ==============================

const { dayIndex, dayIndexToStartMs, dowOfIndex } = require("./stats");

// Замовлення зі статусом cancelled попиту не відображають — відкидаємо.
// Сьогоднішній (неповний) день у навчання не входить: останній
// «повний» день — учора.
function loadSalesData(db, { now = Date.now(), historyDays }) {
  const todayIdx = dayIndex(now);
  const windowStartIdx = todayIdx - historyDays;
  const fromMs = dayIndexToStartMs(windowStartIdx);
  const toMs = dayIndexToStartMs(todayIdx);

  const rows = db
    .prepare(
      `SELECT o.created_at AS ts, oi.product_id AS pid, oi.quantity AS qty, p.category_id AS cat
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ?`
    )
    .all(fromMs, toMs);

  const lastDayIdx = todayIdx - 1;
  if (!rows.length) {
    return {
      todayIdx,
      firstDayIdx: lastDayIdx + 1,
      lastDayIdx,
      nDays: 0,
      series: new Map(),
      hourly: { all: emptyProfile(), byCategory: new Map() },
      totalUnits: 0,
    };
  }

  let firstDayIdx = lastDayIdx;
  for (const r of rows) firstDayIdx = Math.min(firstDayIdx, dayIndex(r.ts));
  const nDays = lastDayIdx - firstDayIdx + 1;

  const series = new Map();
  const hourlyAll = emptyProfile();
  const hourlyByCat = new Map();
  let totalUnits = 0;

  for (const r of rows) {
    const di = dayIndex(r.ts) - firstDayIdx;
    if (di < 0 || di >= nDays) continue;
    let arr = series.get(r.pid);
    if (!arr) {
      arr = new Array(nDays).fill(0);
      series.set(r.pid, arr);
    }
    arr[di] += r.qty;
    totalUnits += r.qty;

    const hour = new Date(r.ts).getHours();
    const kind = dowOfIndex(firstDayIdx + di) >= 5 ? "weekend" : "weekday";
    hourlyAll[kind][hour] += r.qty;
    let cp = hourlyByCat.get(r.cat);
    if (!cp) {
      cp = emptyProfile();
      hourlyByCat.set(r.cat, cp);
    }
    cp[kind][hour] += r.qty;
  }

  return { todayIdx, firstDayIdx, lastDayIdx, nDays, series, hourly: { all: hourlyAll, byCategory: hourlyByCat }, totalUnits };
}

function emptyProfile() {
  return { weekday: new Array(24).fill(0), weekend: new Array(24).fill(0) };
}

module.exports = { loadSalesData };
