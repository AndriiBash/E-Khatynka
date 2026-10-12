// ==============================
// Календарні ознаки для Ridge: «свято» і «переддень свята».
// Список свят — у config.js (CONFIG.calendar), тут лише обчислення.
// Великдень — православний (юліанська пасха, +13 днів до григоріанського).
// ==============================

const { CONFIG } = require("./config");
const { DAY_MS } = require("./stats");

const utcIdx = (year, month, day) => Math.round(Date.UTC(year, month - 1, day) / DAY_MS);

// Православний Великдень (алгоритм Меєуса, коректний для 1900–2099).
function orthodoxEasterIdx(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return utcIdx(year, month, day) + 13; // юліанська дата → григоріанська
}

const holidayCache = new Map(); // рік → Set<індекс дня>

function holidaysOfYear(year) {
  let set = holidayCache.get(year);
  if (set) return set;
  set = new Set();
  const { fixed, easterOffsets } = CONFIG.calendar;
  for (const md of fixed) {
    const [m, d] = md.split("-").map(Number);
    set.add(utcIdx(year, m, d));
  }
  const easter = orthodoxEasterIdx(year);
  for (const off of easterOffsets) set.add(easter + off);
  holidayCache.set(year, set);
  return set;
}

function isHoliday(idx) {
  const year = new Date(idx * DAY_MS).getUTCFullYear();
  return holidaysOfYear(year).has(idx);
}

// [свято, переддень свята] як 0/1. Переддень — день, після якого одразу
// свято (для пекарні це зазвичай найжвавіший день: Великодня субота,
// 24 грудня, 7 березня).
function calendarFlags(idx) {
  const holiday = isHoliday(idx);
  const pre = !holiday && isHoliday(idx + 1);
  return [holiday ? 1 : 0, pre ? 1 : 0];
}

module.exports = { calendarFlags, isHoliday, orthodoxEasterIdx };
