// ==============================
// Сторінка «Аналітика» в адмінці (#/analytics):
//   • Прогноз       — факт і прогноз продажів, прогноз по кожному товару;
//   • Виробництво   — скільки чого спекти (за днями й частинами доби);
//   • Інгредієнти   — потреба, залишок і що докупити;
//   • Знижки        — де мало продажів / ризик списання і яку знижку дати;
//   • Моделі        — точність моделей і припущення розрахунку.
// Усе рахує сервер (src/server/analytics/*) одним запитом — тут лише
// відображення й кнопка «Застосувати знижку».
// ==============================

import { getAnalyticsReport, applyProductDiscount } from "./storage.js";
import { confirmDelete } from "./admin.js";
import type {
  ApiAnalyticsReport,
  ApiDiscountRow,
  ApiForecastRow,
  ApiIngredientNeed,
  ApiPlanRow,
  DiscountStatus,
  ForecastConfidence,
  IngredientNeedStatus,
} from "./types.js";

const CURRENCY = "₴";
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type TabKey = "forecast" | "plan" | "ingredients" | "discounts" | "models";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "forecast", label: "Прогноз продажів" },
  { key: "plan", label: "План виробництва" },
  { key: "ingredients", label: "Інгредієнти" },
  { key: "discounts", label: "Знижки" },
  { key: "models", label: "Моделі й точність" },
];

// Стан сторінки живе між перемиканнями вкладок (і між «Оновити»).
let report: ApiAnalyticsReport | null = null;
let activeTab: TabKey = "forecast";
let planDayIndex = 0;
let forecastQuery = "";
let planShowPurchased = true;
let ingredientsOnlyShortage = false;
let discountsShowAll = false;
const busyDiscounts = new Set<number>();
// Щоб відповідь старого запиту не перезаписала новішу (швидкі кліки «Оновити»).
let requestSeq = 0;

// ---------- Дрібні утиліти

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(value: number, digits = 1): string {
  return value.toLocaleString("uk-UA", { maximumFractionDigits: digits });
}

function fmtPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function fmtQty(value: number, unit: string): string {
  const digits = unit === "шт" || unit === "г" ? 0 : 2;
  return `${fmt(value, digits)} ${esc(unit)}`;
}

function dateLabel(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

// Пн = 0 … Нд = 6 (getUTCDay: Нд = 0)
function weekdayOfIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(d + 6) % 7];
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ---------- Графіки (чистий SVG, без бібліотек)

function totalsChartSvg(r: ApiAnalyticsReport): string {
  const hist = r.totals.history;
  const fc = r.totals.forecast.map((f) => f.units);
  const labels = [...r.historyDates, ...r.dates.map((d) => d.iso)];
  const values = [...hist, ...fc];
  if (!values.length) return `<div class="an-empty">Немає даних для графіка.</div>`;

  const W = 880;
  const H = 240;
  const padL = 40;
  const padR = 8;
  const padT = 14;
  const padB = 30;
  const top = niceMax(Math.max(...values, 1));
  const n = values.length;
  const bw = (W - padL - padR) / n;
  const plotH = H - padT - padB;

  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = H - padB - f * plotH;
      return `<line class="an-grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" /><text class="an-axis" x="${padL - 6}" y="${y + 4}" text-anchor="end">${fmt(top * f, 0)}</text>`;
    })
    .join("");

  const bars = values
    .map((v, i) => {
      const h = (v / top) * plotH;
      const x = padL + i * bw + 1.5;
      const isForecast = i >= hist.length;
      const iso = labels[i];
      const title = `${dateLabel(iso)} (${weekdayOfIso(iso)}): ${fmt(v, 0)} шт.${isForecast ? " — прогноз" : ""}`;
      return `<rect class="an-bar ${isForecast ? "an-bar--fc" : "an-bar--hist"}" x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${Math.max(1, bw - 3).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2"><title>${title}</title></rect>`;
    })
    .join("");

  // Підписи по осі X — приблизно кожен 7-й день, щоб не злипались.
  const xLabels = labels
    .map((iso, i) => {
      if (i % 7 !== 0 && i !== hist.length) return "";
      const x = padL + i * bw + bw / 2;
      return `<text class="an-axis" x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${dateLabel(iso)}</text>`;
    })
    .join("");

  const sepX = padL + hist.length * bw;
  const separator = hist.length
    ? `<line class="an-sep" x1="${sepX}" x2="${sepX}" y1="${padT - 4}" y2="${H - padB}" /><text class="an-axis an-axis--accent" x="${sepX + 6}" y="${padT + 6}">прогноз →</text>`
    : "";

  return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Продажі: факт і прогноз" preserveAspectRatio="xMidYMid meet">${grid}${bars}${xLabels}${separator}</svg>`;
}

function sparklineSvg(recent: number[], fc: number[]): string {
  const values = [...recent, ...fc];
  if (values.length < 2) return "";
  const W = 110;
  const H = 28;
  const max = Math.max(...values, 1);
  const stepX = W / (values.length - 1);
  const pt = (i: number): string => `${(i * stepX).toFixed(1)},${(H - 2 - (values[i] / max) * (H - 4)).toFixed(1)}`;
  const histPts = recent.map((_, i) => pt(i)).join(" ");
  const fcPts = [recent.length - 1, ...fc.map((_, i) => recent.length + i)]
    .filter((i) => i >= 0)
    .map(pt)
    .join(" ");
  return `<svg class="an-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline class="an-spark__hist" points="${histPts}" fill="none" /><polyline class="an-spark__fc" points="${fcPts}" fill="none" /></svg>`;
}

// ---------- Бейджі

function confidenceBadge(c: ForecastConfidence): string {
  const map: Record<ForecastConfidence, [string, string]> = {
    high: ["Висока", "admin-table__badge--success"],
    medium: ["Середня", "admin-table__badge--accent"],
    low: ["Низька", "admin-table__badge--warning"],
  };
  return `<span class="admin-table__badge ${map[c][1]}">${map[c][0]}</span>`;
}

function discountStatusBadge(s: DiscountStatus): string {
  const map: Record<DiscountStatus, [string, string]> = {
    overstock: ["Ризик списання", "admin-table__badge--warning"],
    slow: ["Мало продажів", "admin-table__badge--accent"],
    ok: ["У нормі", "admin-table__badge--success"],
  };
  return `<span class="admin-table__badge ${map[s][1]}">${map[s][0]}</span>`;
}

function ingredientStatusBadge(s: IngredientNeedStatus): string {
  const map: Record<IngredientNeedStatus, [string, string]> = {
    critical: ["Не вистачає на завтра", "admin-table__badge--warning"],
    low: ["Мало на тиждень", "admin-table__badge--accent"],
    ok: ["Достатньо", "admin-table__badge--success"],
    unused: ["Немає в рецептах", "admin-table__badge--accent"],
  };
  return `<span class="admin-table__badge ${map[s][1]}">${map[s][0]}</span>`;
}

// ---------- Каркас сторінки

function root(): HTMLElement | null {
  return document.getElementById("admin-view");
}

function summaryCardsHtml(r: ApiAnalyticsReport): string {
  const tomorrow = r.totals.forecast[0];
  const weekUnits = sum(r.totals.forecast.map((f) => f.units));
  const weekRevenue = sum(r.totals.forecast.map((f) => f.revenue));
  const produce = r.totals.produce[0];
  const daypartText = r.meta.dayparts.map((d) => `${d.label} ${produce?.dayparts[d.id] ?? 0}`).join(" · ");
  const toDiscount = r.discounts.filter((d) => d.action === "apply").length;
  const acc = r.meta.accuracy;

  const card = (label: string, value: string, sub: string): string =>
    `<div class="an-card"><div class="an-card__label">${label}</div><div class="an-card__value">${value}</div><div class="an-card__sub">${sub}</div></div>`;

  return `<div class="an-cards">
    ${card("Прогноз на завтра", `${fmt(tomorrow?.units ?? 0, 0)} шт.`, `≈ ${fmt(tomorrow?.revenue ?? 0, 0)} ${CURRENCY} виручки`)}
    ${card("Прогноз на 7 днів", `${fmt(weekUnits, 0)} шт.`, `≈ ${fmt(weekRevenue, 0)} ${CURRENCY} виручки`)}
    ${card("Випекти завтра", `${fmt(produce?.units ?? 0, 0)} шт.`, esc(daypartText))}
    ${card("Знижки радить система", `${toDiscount} ${toDiscount === 1 ? "товар" : "товарів"}`, "ризик списання або мало продажів")}
    ${card("Помилка прогнозу (WAPE)", fmtPercent(acc.totalWape), acc.totalNaiveWape !== null ? `по всьому обсягу; наївний метод: ${fmtPercent(acc.totalNaiveWape)}` : "замало даних для оцінки")}
  </div>`;
}

function shellHtml(r: ApiAnalyticsReport): string {
  const warnings = r.meta.warnings.map((w) => `<div class="an-alert">${esc(w).replace(/`([^`]+)`/g, "<code>$1</code>")}</div>`).join("");
  const period = r.meta.firstDate && r.meta.lastDate ? `${dateLabel(r.meta.firstDate)} – ${dateLabel(r.meta.lastDate)}` : "—";
  return `
    <button class="admin-back" type="button" id="an-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Аналітика</h1>
    <div class="an-toolbar">
      <div class="an-tabs" id="an-tabs" role="tablist">
        ${TABS.map((t) => `<button class="an-tab" type="button" role="tab" data-tab="${t.key}">${t.label}</button>`).join("")}
      </div>
      <div class="an-toolbar__right">
        <span class="an-toolbar__meta">Історія: ${r.meta.historyDays} дн. (${period}) · розраховано ${new Date(r.generatedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span>
        <button class="btn btn--ghost" type="button" id="an-refresh-btn">Оновити</button>
      </div>
    </div>
    ${warnings}
    <div id="an-message" class="an-message" role="status"></div>
    <div id="an-summary">${summaryCardsHtml(r)}</div>
    <div id="an-content"></div>`;
}

// ---------- Вкладка «Прогноз»

function forecastRowHtml(f: ApiForecastRow): string {
  const tomorrow = f.forecast[0] ?? 0;
  return `<tr>
    <td class="an-cell-name">${esc(f.name)}<span class="an-sub">${esc(f.categoryName)}</span></td>
    <td class="an-num">${fmt(tomorrow, 1)}</td>
    <td class="an-num">${fmt(f.forecastWeek, 1)}</td>
    <td>${sparklineSvg(f.recent, f.forecast)}</td>
    <td class="an-model">${f.modelName ? esc(f.modelName) : "—"}</td>
    <td class="an-num">${fmtPercent(f.wape)}</td>
    <td>${confidenceBadge(f.confidence)}</td>
  </tr>`;
}

function forecastTableBody(r: ApiAnalyticsReport): string {
  const q = forecastQuery.trim().toLowerCase();
  const rows = r.forecast
    .filter((f) => f.status === "ok" && (!q || f.name.toLowerCase().includes(q)))
    .sort((a, b) => b.forecastWeek - a.forecastWeek);
  return rows.length ? rows.map(forecastRowHtml).join("") : `<tr><td colspan="7" class="an-empty">Нічого не знайдено.</td></tr>`;
}

function forecastTabHtml(r: ApiAnalyticsReport): string {
  const noSales = r.forecast.filter((f) => f.status !== "ok").length;
  return `
    <section class="an-panel">
      <div class="an-panel__head">
        <h2 class="admin-section__title">Продажі всього асортименту: факт і прогноз на ${r.meta.horizonDays} днів</h2>
        <div class="an-legend"><span class="an-legend__dot an-legend__dot--hist"></span>факт<span class="an-legend__dot an-legend__dot--fc"></span>прогноз</div>
      </div>
      <div class="an-chart-wrap">${totalsChartSvg(r)}</div>
    </section>
    <section class="an-panel">
      <div class="an-panel__head">
        <h2 class="admin-section__title">Прогноз по товарах</h2>
        <input class="admin-table-search an-search" id="an-forecast-search" type="search" placeholder="Пошук товару" value="${esc(forecastQuery)}" autocomplete="off" />
      </div>
      <p class="admin-section__hint an-hint">Кількість штук на день (середнє очікування). Для кожного товару система сама обирає найточнішу модель за перевіркою на останніх тижнях (backtest); «Довіра» залежить від довжини історії й помилки. ${noSales ? `Без жодного продажу: ${noSales} товарів — їх не показано.` : ""}</p>
      <div class="admin-table-wrap">
        <table class="an-table">
          <thead><tr><th>Товар</th><th class="an-num">Завтра</th><th class="an-num">7 днів</th><th>Динаміка (28 дн. + прогноз)</th><th>Модель</th><th class="an-num">WAPE</th><th>Довіра</th></tr></thead>
          <tbody id="an-forecast-tbody">${forecastTableBody(r)}</tbody>
        </table>
      </div>
    </section>`;
}

// ---------- Вкладка «План виробництва»

function planRowsForDay(r: ApiAnalyticsReport, day: number): ApiPlanRow[] {
  return r.plan
    .filter((p) => (p.perishable || planShowPurchased) && (p.days[day]?.target ?? 0) > 0)
    .sort((a, b) => (b.days[day]?.produce ?? 0) - (a.days[day]?.produce ?? 0));
}

function planTabHtml(r: ApiAnalyticsReport): string {
  const day = Math.min(planDayIndex, r.dates.length - 1);
  const chips = r.dates
    .map((d, k) => `<button class="an-chip${k === day ? " an-chip--active" : ""}" type="button" data-plan-day="${k}">${weekdayOfIso(d.iso)} ${dateLabel(d.iso)}${k === 0 ? " · завтра" : ""}</button>`)
    .join("");

  const total = r.totals.produce[day];
  const daypartsText = r.meta.dayparts.map((d) => `<span class="an-strip__part"><b>${d.label}</b> ${total?.dayparts[d.id] ?? 0}</span>`).join("");

  const rows = planRowsForDay(r, day)
    .map((p) => {
      const d = p.days[day];
      return `<tr>
        <td class="an-cell-name">${esc(p.name)}${p.perishable ? "" : `<span class="an-sub">закупівля, не випічка</span>`}</td>
        <td class="an-num">${fmt(d.forecast, 1)}</td>
        <td class="an-num" title="Критичне співвідношення CR = ${p.criticalRatio}">${d.target}</td>
        <td class="an-num">${day === 0 ? p.stock : "—"}</td>
        <td class="an-num an-num--strong">${d.produce}</td>
        ${r.meta.dayparts.map((dp) => `<td class="an-num">${d.dayparts[dp.id] ?? 0}</td>`).join("")}
      </tr>`;
    })
    .join("");

  return `
    <section class="an-panel">
      <div class="an-chips" id="an-plan-days">${chips}</div>
      <div class="an-strip"><span class="an-strip__total">Разом випекти (швидкопсувне): <b>${fmt(total?.units ?? 0, 0)} шт.</b></span>${daypartsText}</div>
      <label class="an-check"><input type="checkbox" id="an-plan-purchased"${planShowPurchased ? " checked" : ""} /> Показувати й товари з довгим терміном (напої, фасовка)</label>
      <p class="admin-section__hint an-hint">«Ціль» — кількість із запасом за моделлю «продавця газет»: чим вища маржа й коротший термін придатності, тим більший запас; поточний залишок віднімається лише від першого дня. Розбивку за часом доби зроблено за реальним розподілом годин замовлень.</p>
      <div class="admin-table-wrap">
        <table class="an-table">
          <thead><tr><th>Товар</th><th class="an-num">Прогноз</th><th class="an-num">Ціль</th><th class="an-num">На складі</th><th class="an-num">Випекти</th>${r.meta.dayparts.map((dp) => `<th class="an-num">${dp.label}</th>`).join("")}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${5 + r.meta.dayparts.length}" class="an-empty">На цей день випікати нічого.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

// ---------- Вкладка «Інгредієнти»

function ingredientRowHtml(i: ApiIngredientNeed): string {
  const icon = i.iconUrl ? `<img class="an-ing-icon" src="${esc(i.iconUrl)}" alt="" onerror="this.remove()" />` : "";
  return `<tr>
    <td class="an-cell-name an-cell-name--icon">${icon}<span>${esc(i.name)}</span>${i.belowThreshold ? `<span class="an-sub">залишок не вище мінімуму (${fmtQty(i.lowStockThreshold ?? 0, i.unit)})</span>` : ""}</td>
    <td class="an-num">${fmtQty(i.needTomorrow, i.unit)}</td>
    <td class="an-num">${fmtQty(i.needWeek, i.unit)}</td>
    <td class="an-num">${fmtQty(i.stock, i.unit)}</td>
    <td class="an-num an-num--strong">${i.shortageWeek > 0 ? fmtQty(i.shortageWeek, i.unit) : "—"}</td>
    <td>${ingredientStatusBadge(i.status)}</td>
  </tr>`;
}

function ingredientsTabHtml(r: ApiAnalyticsReport): string {
  const rows = r.ingredients.filter((i) => !ingredientsOnlyShortage || i.shortageWeek > 0 || i.belowThreshold);
  const critical = r.ingredients.filter((i) => i.status === "critical").length;
  const unusedCount = r.ingredients.filter((i) => i.status === "unused").length;
  return `
    <section class="an-panel">
      <div class="an-panel__head">
        <h2 class="admin-section__title">Потреба в інгредієнтах на ${r.meta.horizonDays} днів</h2>
        <label class="an-check"><input type="checkbox" id="an-ing-shortage"${ingredientsOnlyShortage ? " checked" : ""} /> Лише дефіцит і низькі залишки</label>
      </div>
      <p class="admin-section__hint an-hint">Показано всі ${r.meta.ingredientsTotal} інгредієнтів зі складу. Потреба = кількість до виробництва × норма з рецепта, підсумок по всіх ${r.meta.productsTotal} товарах${unusedCount ? `; ${unusedCount} інгр. не входять до жодного рецепта` : ""}. ${critical ? `<b>${critical}</b> позицій не вистачає вже на завтра.` : "На завтра всього вистачає."}</p>
      <div class="admin-table-wrap">
        <table class="an-table">
          <thead><tr><th>Інгредієнт</th><th class="an-num">Завтра</th><th class="an-num">7 днів</th><th class="an-num">На складі</th><th class="an-num">Докупити (7 дн.)</th><th>Статус</th></tr></thead>
          <tbody>${rows.length ? rows.map(ingredientRowHtml).join("") : `<tr><td colspan="6" class="an-empty">Дефіциту й низьких залишків немає 🎉</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

// ---------- Вкладка «Знижки»

function discountActionHtml(d: ApiDiscountRow): string {
  const busy = busyDiscounts.has(d.productId);
  if (d.action === "apply") {
    return `<button class="btn btn--primary-sm an-btn" type="button" data-discount-apply="${d.productId}" data-pct="${d.suggestedDiscount}" data-name="${esc(d.name)}"${busy ? " disabled" : ""}>Застосувати −${d.suggestedDiscount}%</button>`;
  }
  if (d.action === "remove") {
    return `<button class="btn btn--ghost an-btn" type="button" data-discount-remove="${d.productId}" data-name="${esc(d.name)}"${busy ? " disabled" : ""}>Зняти знижку</button>`;
  }
  return d.currentDiscount > 0 ? `<span class="an-sub">Знижка діє</span>` : `<span class="an-sub">—</span>`;
}

function discountRowHtml(d: ApiDiscountRow): string {
  const m = d.metrics;
  const pctText = d.action === "remove" ? `${d.currentDiscount}% → 0%` : d.action === "none" ? "—" : `${d.currentDiscount}% → ${d.suggestedDiscount}%`;
  const priceText = d.suggestedDiscount !== d.currentDiscount || d.action === "remove" ? `${fmt(d.price, 0)} → <b>${fmt(d.newPrice, 0)} ${CURRENCY}</b>` : `${fmt(d.newPrice, 0)} ${CURRENCY}`;
  return `<tr>
    <td class="an-cell-name">${esc(d.name)}<span class="an-sub an-sub--wrap">${esc(d.reason)}</span></td>
    <td class="an-num">${m.stock} шт.<span class="an-sub">термін ${m.shelfLifeDays} дн.</span></td>
    <td class="an-num">${m.sold14}<span class="an-sub">${fmt(m.velocity, 1)} шт/дн · ${Math.round(m.relativeVelocity * 100)}% медіани</span></td>
    <td>${discountStatusBadge(d.status)}</td>
    <td class="an-num">${pctText}<span class="an-sub">${d.expectedUpliftPct > 0 && d.action === "apply" ? `попит ≈ +${d.expectedUpliftPct}%` : ""}</span></td>
    <td class="an-num">${priceText}</td>
    <td class="an-actions">${discountActionHtml(d)}</td>
  </tr>`;
}

function discountsTabHtml(r: ApiAnalyticsReport): string {
  const attention = r.discounts.filter((d) => d.status !== "ok" || d.action === "remove");
  const rows = discountsShowAll ? r.discounts : attention;
  return `
    <section class="an-panel">
      <div class="an-panel__head">
        <h2 class="admin-section__title">Де мало продажів — знижки на товари пекарні</h2>
        <label class="an-check"><input type="checkbox" id="an-disc-all"${discountsShowAll ? " checked" : ""} /> Показати всі ${r.discounts.length} товарів</label>
      </div>
      <p class="admin-section__hint an-hint">Аналізується весь асортимент (${r.discounts.length} товарів), у списку — ті, що потребують уваги: ${attention.length}. «Ризик списання» рахується лише для швидкопсувних товарів (термін ≤ ${r.meta.perishableMaxShelfDays} дн.); для решти (напої, фасовка) — лише «Мало продажів». «Ризик списання» — залишок не встигне розійтись до кінця терміну при прогнозованому попиті; «Мало продажів» — швидкість продажів менша за половину медіани категорії або різко впала за тиждень. Знижка не опускає ціну нижче собівартості (припущення: ${Math.round(r.meta.costRatio * 100)}% ціни); приріст попиту оцінено за еластичністю ${r.meta.priceElasticity} — це припущення, а не виміряний факт.</p>
      <div class="admin-table-wrap">
        <table class="an-table an-table--discounts">
          <thead><tr><th>Товар і причина</th><th class="an-num">Залишок</th><th class="an-num">Продано за 14 дн.</th><th>Статус</th><th class="an-num">Знижка</th><th class="an-num">Ціна</th><th></th></tr></thead>
          <tbody id="an-discounts-tbody">${rows.length ? rows.map(discountRowHtml).join("") : `<tr><td colspan="7" class="an-empty">Товарів із низькими продажами чи ризиком списання не знайдено 🎉</td></tr>`}</tbody>
        </table>
      </div>
    </section>`;
}

// ---------- Вкладка «Моделі й точність»

function modelsTabHtml(r: ApiAnalyticsReport): string {
  const a = r.meta.accuracy;
  const rows = r.models
    .map((m) => `<tr><td class="an-cell-name">${esc(m.name)}</td><td class="an-num">${fmtPercent(m.wape)}</td><td class="an-num">${m.chosenCount}</td></tr>`)
    .join("");
  return `
    <section class="an-panel">
      <h2 class="admin-section__title">Точність прогнозу</h2>
      <div class="an-cards an-cards--tight">
        <div class="an-card"><div class="an-card__label">WAPE, загальний обсяг</div><div class="an-card__value">${fmtPercent(a.totalWape)}</div><div class="an-card__sub">${a.totalModel ? esc(a.totalModel) : "—"} · наївний: ${fmtPercent(a.totalNaiveWape)}</div></div>
        <div class="an-card"><div class="an-card__label">WAPE, по товарах</div><div class="an-card__value">${fmtPercent(a.wape)}</div><div class="an-card__sub">обрані моделі · наївний: ${fmtPercent(a.naiveWape)}</div></div>
      </div>
      <p class="admin-section__hint an-hint">WAPE = Σ|прогноз − факт| / Σ факт на тестових тижнях (rolling-origin, навчання лише на даних ДО тижня). По окремих товарах він завжди вищий: продажі дрібні (кілька штук на день), тож випадковий шум великий; у сумі по асортименту шум гаситься.</p>
      <div class="admin-table-wrap">
        <table class="an-table">
          <thead><tr><th>Модель</th><th class="an-num">WAPE по всіх товарах</th><th class="an-num">Обрано для товарів</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="an-empty">Замало даних для порівняння моделей.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
    <section class="an-panel">
      <h2 class="admin-section__title">Припущення розрахунку</h2>
      <ul class="an-list">
        <li>Історія: ${r.meta.historyDays} дн. (скасовані замовлення не враховуються); горизонт — ${r.meta.horizonDays} дн. від завтра.</li>
        <li>Собівартість = ${Math.round(r.meta.costRatio * 100)}% від ціни (у БД її немає) — впливає на страховий запас і межу знижки.</li>
        <li>Частини доби: ${r.meta.dayparts.map((d) => `${d.label} ${d.from}–${d.to}`).join(", ")} год.</li>
        <li>Сезонність — тижнева (день тижня) плюс профіль годин замовлень; річну сезонність без ≥ 1 року історії оцінити неможливо.</li>
        <li>Продажі обмежені залишком на складі (нема товару — нема продажу), тож реальний попит на дефіцитні позиції може бути вищим за прогноз.</li>
      </ul>
    </section>`;
}

// ---------- Рендер і події

function renderContent(): void {
  const content = document.getElementById("an-content");
  if (!content || !report) return;
  const html: Record<TabKey, (r: ApiAnalyticsReport) => string> = {
    forecast: forecastTabHtml,
    plan: planTabHtml,
    ingredients: ingredientsTabHtml,
    discounts: discountsTabHtml,
    models: modelsTabHtml,
  };
  content.innerHTML = html[activeTab](report);
  document.querySelectorAll<HTMLElement>("#an-tabs [data-tab]").forEach((btn) => {
    const active = btn.dataset.tab === activeTab;
    btn.classList.toggle("an-tab--active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

function showMessage(text: string, isError = false): void {
  const el = document.getElementById("an-message");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("an-message--error", isError);
  el.classList.toggle("an-message--visible", text.length > 0);
}

function bindShell(): void {
  document.getElementById("an-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("an-refresh-btn")?.addEventListener("click", () => {
    void loadAndRender(false);
  });
  document.getElementById("an-tabs")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (!btn) return;
    activeTab = btn.dataset.tab as TabKey;
    showMessage("");
    renderContent();
  });

  // Один делегований обробник на вміст вкладок — сам вміст перемальовується.
  const content = document.getElementById("an-content");
  content?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const dayBtn = target.closest<HTMLElement>("[data-plan-day]");
    if (dayBtn) {
      planDayIndex = Number(dayBtn.dataset.planDay);
      renderContent();
      return;
    }

    const applyBtn = target.closest<HTMLButtonElement>("[data-discount-apply]");
    if (applyBtn && !applyBtn.disabled) {
      const productId = Number(applyBtn.dataset.discountApply);
      const pct = Number(applyBtn.dataset.pct);
      const name = applyBtn.dataset.name ?? "цей товар";
      void (async () => {
        const confirmed = await confirmDelete(
          "Застосувати знижку?",
          `«${name}»: ціна в каталозі одразу зміниться на −${pct}%. Продовжити?`,
          "Так, застосувати"
        );
        if (confirmed) void onApplyDiscount(productId, pct);
      })();
    }
    const removeBtn = target.closest<HTMLButtonElement>("[data-discount-remove]");
    if (removeBtn && !removeBtn.disabled) {
      const productId = Number(removeBtn.dataset.discountRemove);
      const name = removeBtn.dataset.name ?? "цей товар";
      void (async () => {
        const confirmed = await confirmDelete(
          "Зняти знижку?",
          `«${name}»: знижку буде знято, ціна в каталозі повернеться до звичайної. Продовжити?`,
          "Так, зняти"
        );
        if (confirmed) void onApplyDiscount(productId, 0);
      })();
    }
  });

  content?.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === "an-forecast-search" && report) {
      forecastQuery = target.value;
      const tbody = document.getElementById("an-forecast-tbody");
      if (tbody) tbody.innerHTML = forecastTableBody(report);
    }
  });

  content?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.id === "an-plan-purchased") {
      planShowPurchased = target.checked;
      renderContent();
    } else if (target.id === "an-disc-all") {
      discountsShowAll = target.checked;
      renderContent();
    } else if (target.id === "an-ing-shortage") {
      ingredientsOnlyShortage = target.checked;
      renderContent();
    }
  });
}

async function onApplyDiscount(productId: number, percent: number): Promise<void> {
  if (busyDiscounts.has(productId)) return;
  busyDiscounts.add(productId);
  renderContent();

  const result = await applyProductDiscount(productId, percent);
  busyDiscounts.delete(productId);

  if (!result.ok) {
    renderContent();
    showMessage(result.error, true);
    return;
  }

  const name = report?.discounts.find((d) => d.productId === productId)?.name ?? "Товар";
  // Перерахунок звіту: статус рядка змінюється (знижка вже діє).
  await loadAndRender(true);
  showMessage(percent > 0 ? `«${name}»: знижку ${percent}% застосовано — ціна в каталозі оновилась.` : `«${name}»: знижку знято.`);
}

// keepMessage — щоб після «Застосувати» не стирати щойно показане
// повідомлення (воно виставляється вже після перерахунку).
async function loadAndRender(keepShell: boolean): Promise<void> {
  const view = root();
  if (!view) return;
  const seq = ++requestSeq;

  const refreshBtn = document.getElementById("an-refresh-btn") as HTMLButtonElement | null;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Рахуємо…";
  }
  if (!report && !keepShell) view.innerHTML = `<h1 class="admin-page__title">Аналітика</h1><div class="an-loading">Рахуємо прогноз…</div>`;

  const result = await getAnalyticsReport();
  // Користувач міг піти з розділу або запустити новіший запит, поки чекали.
  if (seq !== requestSeq || window.location.hash !== "#/analytics") return;

  if (!result.ok) {
    view.innerHTML = `
      <button class="admin-back" type="button" id="an-back-btn">← Усі таблиці</button>
      <h1 class="admin-page__title">Аналітика</h1>
      <div class="an-alert an-alert--error">${esc(result.error)}</div>
      <button class="btn btn--primary-sm" type="button" id="an-retry-btn">Спробувати ще раз</button>`;
    document.getElementById("an-back-btn")?.addEventListener("click", () => {
      window.location.hash = "";
    });
    document.getElementById("an-retry-btn")?.addEventListener("click", () => {
      void loadAndRender(false);
    });
    return;
  }

  report = result.report;
  view.innerHTML = shellHtml(report);
  bindShell();
  renderContent();
}

export async function renderAnalytics(): Promise<void> {
  report = null; // при вході в розділ — завжди свіжий розрахунок
  planDayIndex = 0;
  showMessage("");
  await loadAndRender(false);
}
