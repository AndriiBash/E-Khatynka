// ==============================
// Налаштування оптових замовлень. Усе, що може захотіти змінити
// власник пекарні, зібрано тут, а не розкидано по роутах.
// ==============================

// Мінімум годин між оформленням оптового замовлення й самовивозом:
// пекарні потрібен час, щоб запланувати виробництво.
const WHOLESALE_MIN_LEAD_HOURS = 12;

// Як далеко наперед можна замовляти.
const WHOLESALE_MAX_DAYS_AHEAD = 30;

// Години видачі (самовивіз): слоти кожні 30 хв з першої по останню.
const PICKUP_FIRST_HOUR = 7;
const PICKUP_LAST_HOUR = 19;

// Мінімальна кількість КОЖНОГО товару в оптовому замовленні (шт.).
const WHOLESALE_MIN_QTY_PER_ITEM = 10;

// Знижка за обсяг: залежить від загальної кількості штук у замовленні.
// Береться найвищий поріг, який замовлення вже перекрило.
const WHOLESALE_DISCOUNT_TIERS = [
  { minPieces: 50, percent: 5 },
  { minPieces: 100, percent: 10 },
  { minPieces: 200, percent: 15 },
  { minPieces: 500, percent: 20 },
  { minPieces: 1000, percent: 25 },
];

// Жорсткий стелю: СУМАРНА знижка на товар (власна акція товару + знижка
// за обсяг) ніколи не перевищує цей відсоток.
const WHOLESALE_MAX_TOTAL_DISCOUNT = 30;

function wholesaleVolumePercent(totalPieces) {
  let percent = 0;
  for (const tier of WHOLESALE_DISCOUNT_TIERS) {
    if (totalPieces >= tier.minPieces) percent = tier.percent;
  }
  return percent;
}

/** Ціна одиниці для опту: базова ціна мінус (акція товару + знижка за обсяг, не більше стелі). */
function wholesaleUnitPrice(row, volumePercent) {
  const total = Math.min(WHOLESALE_MAX_TOTAL_DISCOUNT, (row.discount_percent || 0) + volumePercent);
  return total > 0 ? Math.round(row.price * (1 - total / 100) * 100) / 100 : row.price;
}

module.exports = {
  WHOLESALE_MIN_QTY_PER_ITEM,
  WHOLESALE_DISCOUNT_TIERS,
  WHOLESALE_MAX_TOTAL_DISCOUNT,
  wholesaleVolumePercent,
  wholesaleUnitPrice,
  WHOLESALE_MIN_LEAD_HOURS,
  WHOLESALE_MAX_DAYS_AHEAD,
  PICKUP_FIRST_HOUR,
  PICKUP_LAST_HOUR,
};
