import { getSession, logout, getCategories } from "./storage.js";
import { PRODUCTS, loadProducts, type Product } from "./products.js";
import { userMenuHtml, setupUserMenu } from "./user-menu.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { setupSwipeToClose } from "./swipe-sheet.js";
import type { SessionUser, ApiCategory, ApiOrder } from "./types.js";

// ==============================
// Сторінка оптового замовлення (wholesale.html).
//
// Оптовик не ходить по картках і не докладає по одній штуці — він
// набирає список у таблиці (десятки позицій, кількості числом), обирає
// день і час самовивозу й оформлює одним запитом. Кошик магазину тут не
// використовується: замовлення йде прямо в POST /api/orders/wholesale.
// ==============================

const CURRENCY = "₴";
const MAX_QTY = 100000;
const QUICK_STEP = 10;
// Невеликий запас до мінімального часу самовивозу: поки людина
// заповнює форму, "найближчий слот" не повинен встигнути прострочитись.
const LEAD_MARGIN_MS = 5 * 60 * 1000;

interface DiscountTier {
  minPieces: number;
  percent: number;
}

interface WholesaleConfig {
  minLeadHours: number;
  maxDaysAhead: number;
  firstHour: number;
  lastHour: number;
  minQtyPerItem: number;
  discountTiers: DiscountTier[];
  maxTotalDiscount: number;
}

interface WholesaleResult {
  ok: boolean;
  error?: string;
  order?: ApiOrder;
  volumeDiscountPercent?: number;
  subtotal?: number;
}

const quantities = new Map<string, number>();
let config: WholesaleConfig = {
  minLeadHours: 12,
  maxDaysAhead: 30,
  firstHour: 7,
  lastHour: 19,
  minQtyPerItem: 10,
  discountTiers: [
    { minPieces: 50, percent: 5 },
    { minPieces: 100, percent: 10 },
    { minPieces: 200, percent: 15 },
    { minPieces: 500, percent: 20 },
    { minPieces: 1000, percent: 25 },
  ],
  maxTotalDiscount: 30,
};
let categories: ApiCategory[] = [];
let currentUser: SessionUser | null = null;
let searchQuery = "";
let activeCategory = "all";
let onlySelected = false;
// Обраний день (YYYY-MM-DD), місяць, що показаний у календарі, і обраний слот.
let pickupDate = "";
let calendarMonth = new Date();
let pickupTs: number | null = null;
let checkoutOpen = false;
let escapeBound = false;

// ---------- утиліти ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const hasFraction = Math.abs(rounded % 1) > 0;
  return `${rounded.toLocaleString("uk-UA", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })} ${CURRENCY}`;
}

function formatPickup(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
  const weekday = d.toLocaleDateString("uk-UA", { weekday: "long" });
  return `${day} (${weekday}), ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** У БД вага зберігається числом без одиниці ("120") — додаємо "г". */
function formatWeight(weight: string): string {
  const w = weight.trim();
  if (!w) return "";
  return /^\d+([.,]\d+)?$/.test(w) ? `${w} г` : w;
}

function monthTitle(d: Date): string {
  const text = d.toLocaleDateString("uk-UA", { month: "long", year: "numeric" }).replace(/\s*р\.?$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function getRoot(): HTMLElement {
  return el<HTMLElement>("ws-root");
}

// ---------- слоти самовивозу ----------

function minPickupTs(): number {
  return Date.now() + config.minLeadHours * 60 * 60 * 1000 + LEAD_MARGIN_MS;
}

function maxPickupTs(): number {
  return Date.now() + config.maxDaysAhead * 24 * 60 * 60 * 1000;
}

/** Усі доступні слоти (кожні 30 хв) для дня у форматі YYYY-MM-DD. */
function slotsForDate(dateValue: string): number[] {
  const [y, m, d] = dateValue.split("-").map(Number);
  if (!y || !m || !d) return [];
  const min = minPickupTs();
  const max = maxPickupTs();
  const result: number[] = [];
  for (let h = config.firstHour; h <= config.lastHour; h += 1) {
    for (const minutes of [0, 30]) {
      if (h === config.lastHour && minutes > 0) continue;
      const ts = new Date(y, m - 1, d, h, minutes, 0, 0).getTime();
      if (ts >= min && ts <= max) result.push(ts);
    }
  }
  return result;
}

/** Найближчий день, у якому ще є хоч один вільний слот. */
function earliestDate(): string | null {
  const day = new Date();
  for (let i = 0; i <= config.maxDaysAhead + 1; i += 1) {
    const value = toDateInputValue(day);
    if (slotsForDate(value).length > 0) return value;
    day.setDate(day.getDate() + 1);
  }
  return null;
}

// ---------- відбір і підсумки ----------

function visibleProducts(): Product[] {
  const q = searchQuery.trim().toLowerCase();
  return PRODUCTS.filter((p) => {
    if (activeCategory !== "all" && p.category !== activeCategory) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (onlySelected && (quantities.get(p.id) ?? 0) <= 0) return false;
    return true;
  });
}

// ---------- знижка за обсяг ----------

function volumePercentFor(pieces: number): number {
  let percent = 0;
  for (const tier of config.discountTiers) {
    if (pieces >= tier.minPieces) percent = tier.percent;
  }
  return percent;
}

function nextTier(pieces: number): DiscountTier | null {
  return config.discountTiers.find((t) => t.minPieces > pieces) ?? null;
}

/** Ціна одиниці з урахуванням знижки за обсяг (дзеркало серверної wholesaleUnitPrice). */
function unitPrice(p: Product, volumePercent: number): number {
  const total = Math.min(config.maxTotalDiscount, p.discountPercent + volumePercent);
  return total > 0 ? Math.round(p.originalPrice * (1 - total / 100) * 100) / 100 : p.originalPrice;
}

function isBelowMin(qty: number): boolean {
  return qty > 0 && qty < config.minQtyPerItem;
}

function totals(): {
  lines: number;
  pieces: number;
  subtotal: number;
  sum: number;
  volumePercent: number;
  belowMin: number;
} {
  let lines = 0;
  let pieces = 0;
  let subtotal = 0;
  let belowMin = 0;
  const found: Array<{ product: Product; qty: number }> = [];
  for (const [id, qty] of quantities) {
    if (qty <= 0) continue;
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product) continue;
    lines += 1;
    pieces += qty;
    if (isBelowMin(qty)) belowMin += 1;
    subtotal += product.price * qty;
    found.push({ product, qty });
  }
  const volumePercent = volumePercentFor(pieces);
  const sum = found.reduce((acc, { product, qty }) => acc + unitPrice(product, volumePercent) * qty, 0);
  return {
    lines,
    pieces,
    subtotal: Math.round(subtotal * 100) / 100,
    sum: Math.round(sum * 100) / 100,
    volumePercent,
    belowMin,
  };
}

// ---------- розмітка ----------

function productRowHtml(p: Product): string {
  const qty = quantities.get(p.id) ?? 0;
  const thumb = p.imageUrl
    ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />`
    : `<span aria-hidden="true">${p.emoji}</span>`;
  const price = unitPrice(p, totals().volumePercent);
  const oldPrice =
    p.originalPrice > price ? `<s class="ws-price__old" data-old>${formatMoney(p.originalPrice)}</s>` : `<s class="ws-price__old" data-old hidden></s>`;
  const weight = formatWeight(p.weight);
  const meta = weight ? `<span class="ws-name__meta">${escapeHtml(weight)}</span>` : "";

  return `
    <div class="ws-row${qty > 0 ? " is-active" : ""}${isBelowMin(qty) ? " is-invalid" : ""}" data-id="${p.id}" role="row">
      <div class="ws-product" role="cell">
        <div class="ws-thumb">${thumb}</div>
        <div class="ws-name">
          <span class="ws-name__title">${escapeHtml(p.name)}</span>
          ${meta}
        </div>
      </div>
      <div class="ws-price" role="cell">
        <span class="ws-price__now" data-price>${formatMoney(price)}</span>
        ${oldPrice}
      </div>
      <div class="ws-qty" role="cell">
        <button type="button" class="ws-step" data-act="dec" aria-label="Менше: ${escapeHtml(p.name)}">−</button>
        <input class="ws-qty__input" type="text" inputmode="numeric" autocomplete="off"
               placeholder="0" value="${qty > 0 ? qty : ""}" aria-label="Кількість: ${escapeHtml(p.name)}" />
        <button type="button" class="ws-step" data-act="inc" aria-label="Більше: ${escapeHtml(p.name)}">+</button>
        <button type="button" class="ws-step ws-step--quick" data-act="quick" aria-label="Додати ${QUICK_STEP}: ${escapeHtml(p.name)}">+${QUICK_STEP}</button>
      </div>
      <div class="ws-sum" role="cell">
        <span data-sum>${qty > 0 ? formatMoney(price * qty) : "—"}</span>
        <span class="ws-sum__warn" data-warn${isBelowMin(qty) ? "" : " hidden"}>мін. ${config.minQtyPerItem} шт.</span>
      </div>
    </div>`;
}

function chipsHtml(): string {
  const chip = (id: string, label: string): string =>
    `<button type="button" class="ws-chip${activeCategory === id ? " is-active" : ""}" data-cat="${id}">${escapeHtml(label)}</button>`;
  return [chip("all", "Усі"), ...categories.map((c) => chip(String(c.id), c.name))].join("");
}

function renderShell(): void {
  getRoot().innerHTML = `
    <div class="ws-head">
      <div>
        <h1 class="ws-title">Оптове замовлення</h1>
        <p class="ws-lead">Складіть список, оберіть день і час самовивозу — приготуємо все до вказаного часу.</p>
        <div class="ws-rules">
          <span class="ws-rules__min">Мінімум <strong>${config.minQtyPerItem} шт.</strong> кожного товару</span>
          <span class="ws-rules__tiers">${config.discountTiers
            .map((t) => `<span class="ws-tier" data-tier="${t.minPieces}">від ${t.minPieces} шт. <b>−${t.percent}%</b></span>`)
            .join("")}</span>
        </div>
      </div>
      <a class="ws-link" href="index.html">Звичайний каталог</a>
    </div>

    <div class="ws-layout">
      <section class="ws-list" aria-label="Товари">
        <div class="ws-tools">
          <div class="ws-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21L17.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="text" id="ws-search" placeholder="Знайти товар" autocomplete="off" spellcheck="false" />
          </div>
          <div class="ws-chips" id="ws-chips">${chipsHtml()}</div>
          <label class="ws-toggle">
            <input type="checkbox" id="ws-only-selected" />
            <span>Лише додані <span class="ws-toggle__count" id="ws-selected-count"></span></span>
          </label>
        </div>

        <div class="ws-table" role="table" aria-label="Список товарів">
          <div class="ws-table__head" role="row">
            <span role="columnheader">Товар</span>
            <span role="columnheader">Ціна</span>
            <span role="columnheader">Кількість</span>
            <span role="columnheader">Сума</span>
          </div>
          <div id="ws-rows"></div>
          <p class="ws-empty" id="ws-empty" hidden>Нічого не знайдено</p>
        </div>
      </section>

      <aside class="ws-summary" id="ws-summary" aria-label="Підсумок замовлення">
        <h2 class="ws-summary__title">Ваше замовлення</h2>

        <div class="ws-promo" id="ws-promo"></div>

        <dl class="ws-totals">
          <div><dt>Позицій</dt><dd id="ws-lines">0</dd></div>
          <div><dt>Штук</dt><dd id="ws-pieces">0</dd></div>
          <div id="ws-subtotal-row" hidden><dt>Без знижки</dt><dd><s id="ws-subtotal"></s></dd></div>
          <div class="ws-totals__discount" id="ws-discount-row" hidden><dt id="ws-discount-label"></dt><dd id="ws-discount"></dd></div>
          <div class="ws-totals__grand"><dt>Разом</dt><dd id="ws-total">0 ${CURRENCY}</dd></div>
        </dl>

        <button type="button" class="btn--primary" id="ws-open" disabled>Оформити</button>
        <p class="ws-hint" id="ws-hint"></p>
      </aside>
    </div>

    <div class="ws-modal" id="ws-checkout" hidden>
      <div class="ws-modal__backdrop" data-close></div>
      <div class="ws-modal__panel" id="ws-checkout-panel" role="dialog" aria-modal="true" aria-labelledby="ws-checkout-title">
        <div class="ws-modal__handle" id="ws-checkout-handle" aria-hidden="true"><span></span></div>
        <header class="ws-modal__head">
          <div>
            <h2 class="ws-modal__title" id="ws-checkout-title">Самовивіз</h2>
            <p class="ws-modal__note" id="ws-earliest"></p>
          </div>
          <button type="button" class="ws-modal__close" data-close aria-label="Закрити">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </header>

        <div class="ws-modal__body">
          <div class="ws-modal__col">
            <div class="field">
              <label>День</label>
              <div class="cal" id="ws-cal"></div>
            </div>
          </div>
          <div class="ws-modal__col">
            <div class="field">
              <label>Час</label>
              <div class="slots" id="ws-slots"></div>
            </div>
            <div class="field">
              <label for="ws-phone">Телефон</label>
              <input type="tel" id="ws-phone" autocomplete="tel" inputmode="tel" />
            </div>
            <div class="field">
              <label for="ws-comment">Коментар до замовлення</label>
              <textarea id="ws-comment" rows="2" maxlength="500" placeholder="Наприклад: упаковка, час звʼязку"></textarea>
            </div>
          </div>
        </div>

        <footer class="ws-modal__foot">
          <p class="form-message" id="ws-message"></p>
          <div class="ws-modal__foot-row">
            <div class="ws-modal__sum">
              <span class="ws-modal__sum-label" id="ws-modal-pickup"></span>
              <span class="ws-modal__sum-total" id="ws-modal-total"></span>
            </div>
            <button type="button" class="btn--primary ws-modal__confirm" id="ws-submit" disabled>Підтвердити</button>
          </div>
        </footer>
      </div>
    </div>

    <div class="ws-bar" id="ws-bar" hidden>
      <div class="ws-bar__info">
        <span class="ws-bar__count" id="ws-bar-count"></span>
        <span class="ws-bar__total" id="ws-bar-total"></span>
      </div>
      <button type="button" class="btn btn--primary-sm" id="ws-bar-go">Оформити</button>
    </div>
  `;
}

// ---------- оновлення без повного перерендеру ----------

function renderRows(): void {
  const list = visibleProducts();
  el<HTMLElement>("ws-rows").innerHTML = list.map(productRowHtml).join("");
  el<HTMLElement>("ws-empty").hidden = list.length > 0;
}

function updateRow(productId: string): void {
  const row = document.querySelector<HTMLElement>(`.ws-row[data-id="${CSS.escape(productId)}"]`);
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!row || !product) return;
  const qty = quantities.get(productId) ?? 0;
  row.classList.toggle("is-active", qty > 0);
  row.classList.toggle("is-invalid", isBelowMin(qty));
  const price = unitPrice(product, totals().volumePercent);
  const priceEl = row.querySelector<HTMLElement>("[data-price]");
  if (priceEl) priceEl.textContent = formatMoney(price);
  const oldEl = row.querySelector<HTMLElement>("[data-old]");
  if (oldEl) {
    oldEl.hidden = !(product.originalPrice > price);
    oldEl.textContent = product.originalPrice > price ? formatMoney(product.originalPrice) : "";
  }
  const warn = row.querySelector<HTMLElement>("[data-warn]");
  if (warn) warn.hidden = !isBelowMin(qty);
  const input = row.querySelector<HTMLInputElement>(".ws-qty__input");
  // Не перезаписуємо поле, поки в ньому друкують (інакше курсор стрибає).
  if (input && document.activeElement !== input) input.value = qty > 0 ? String(qty) : "";
  const sum = row.querySelector<HTMLElement>("[data-sum]");
  if (sum) sum.textContent = qty > 0 ? formatMoney(price * qty) : "—";
}

/** Знижка за обсяг змінює ціну в усіх рядках одразу — оновлюємо видимі. */
function refreshAllRows(): void {
  document.querySelectorAll<HTMLElement>(".ws-row").forEach((row) => {
    if (row.dataset.id) updateRow(row.dataset.id);
  });
}

function updateSummary(): void {
  const t = totals();
  el<HTMLElement>("ws-lines").textContent = String(t.lines);
  el<HTMLElement>("ws-pieces").textContent = String(t.pieces);
  el<HTMLElement>("ws-total").textContent = formatMoney(t.sum);
  const saved = Math.round((t.subtotal - t.sum) * 100) / 100;
  el<HTMLElement>("ws-subtotal-row").hidden = saved <= 0;
  el<HTMLElement>("ws-discount-row").hidden = saved <= 0;
  el<HTMLElement>("ws-subtotal").textContent = formatMoney(t.subtotal);
  el<HTMLElement>("ws-discount-label").textContent = `Знижка за обсяг (−${t.volumePercent}%)`;
  el<HTMLElement>("ws-discount").textContent = `−${formatMoney(saved)}`;
  renderPromo(t.pieces, t.volumePercent);
  document.querySelectorAll<HTMLElement>(".ws-tier").forEach((tier) => {
    tier.classList.toggle("is-reached", t.pieces >= Number(tier.dataset.tier));
  });
  refreshAllRows();
  el<HTMLElement>("ws-selected-count").textContent = t.lines > 0 ? `(${t.lines})` : "";

  const bar = el<HTMLElement>("ws-bar");
  bar.hidden = t.lines === 0;
  el<HTMLElement>("ws-bar-count").textContent = `${t.lines} поз. · ${t.pieces} шт.`;
  el<HTMLElement>("ws-bar-total").textContent = formatMoney(t.sum);

  updateSubmitState();
}

function selectedPickupTs(): number | null {
  return pickupTs;
}

/** Підказка про наступний поріг знижки + прогрес-смужка. */
function renderPromo(pieces: number, percent: number): void {
  const box = el<HTMLElement>("ws-promo");
  const next = nextTier(pieces);
  if (pieces === 0) {
    box.innerHTML = `<span class="ws-promo__text">Знижка за обсяг діє від ${config.discountTiers[0].minPieces} шт. в замовленні.</span>`;
    return;
  }
  const prevMin = [...config.discountTiers].reverse().find((t) => pieces >= t.minPieces)?.minPieces ?? 0;
  const progress = next ? Math.min(100, Math.round(((pieces - prevMin) / (next.minPieces - prevMin)) * 100)) : 100;
  const text = next
    ? `${percent > 0 ? `Ваша знижка <strong>−${percent}%</strong>. ` : ""}Ще <strong>${next.minPieces - pieces} шт.</strong> — і знижка буде <strong>−${next.percent}%</strong>.`
    : `Максимальна знижка за обсяг: <strong>−${percent}%</strong>.`;
  box.innerHTML = `<span class="ws-promo__text">${text}</span><span class="ws-promo__bar"><span style="width:${progress}%"></span></span>`;
}

function updateSubmitState(): void {
  const t = totals();
  const hasSlot = selectedPickupTs() !== null;
  const ready = t.lines > 0 && t.belowMin === 0;

  // Кнопка в правій панелі лише відкриває вікно оформлення.
  el<HTMLButtonElement>("ws-open").disabled = !ready;
  const hint = el<HTMLElement>("ws-hint");
  if (t.lines === 0) hint.textContent = "Додайте хоча б один товар";
  else if (t.belowMin > 0) hint.textContent = `Мінімум ${config.minQtyPerItem} шт. кожного товару — виправте позначені позиції`;
  else hint.textContent = "";
  hint.hidden = hint.textContent === "";

  // Підтвердження у вікні потребує обраного часу.
  el<HTMLButtonElement>("ws-submit").disabled = !ready || !hasSlot;
  el<HTMLElement>("ws-modal-pickup").textContent = hasSlot
    ? `Самовивіз: ${formatPickup(selectedPickupTs() as number)}`
    : "Оберіть день і час";
  el<HTMLElement>("ws-modal-total").textContent = formatMoney(t.sum);
}

// ---------- вікно оформлення (на мобілці — шторка знизу) ----------

function openCheckout(): void {
  if (checkoutOpen) return;
  checkoutOpen = true;
  showMessage("", false);
  el<HTMLElement>("ws-checkout").hidden = false;
  // Наступний кадр — щоб спрацював transition появи.
  requestAnimationFrame(() => el<HTMLElement>("ws-checkout").classList.add("is-open"));
  lockScroll();
  updateSubmitState();
}

function closeCheckout(): void {
  if (!checkoutOpen) return;
  checkoutOpen = false;
  const modal = document.getElementById("ws-checkout");
  unlockScroll();
  if (!modal) return;
  modal.classList.remove("is-open");
  window.setTimeout(() => {
    if (!checkoutOpen) modal.hidden = true;
  }, 220);
}

function setQty(productId: string, qty: number): void {
  const clamped = Math.max(0, Math.min(MAX_QTY, Math.floor(qty)));
  if (clamped === 0) quantities.delete(productId);
  else quantities.set(productId, clamped);

  if (onlySelected && clamped === 0) {
    // Рядок, який став порожнім, зникає з відбору "Лише додані" —
    // перемальовуємо список, але лишаємо фокус на сторінці.
    renderRows();
  } else {
    updateRow(productId);
  }
  updateSummary();
}

// ---------- форма самовивозу ----------

function setPickupDate(value: string): void {
  pickupDate = value;
  const slots = value ? slotsForDate(value) : [];
  pickupTs = slots.length > 0 ? slots[0] : null;
  renderCalendar();
  renderSlots();
  updateSubmitState();
}

function renderSlots(): void {
  const box = el<HTMLElement>("ws-slots");
  const slots = pickupDate ? slotsForDate(pickupDate) : [];
  if (slots.length === 0) {
    box.innerHTML = `<p class="slots__empty">Немає вільного часу</p>`;
    return;
  }
  box.innerHTML = slots
    .map((ts) => {
      const d = new Date(ts);
      return `<button type="button" class="slot${ts === pickupTs ? " is-selected" : ""}" data-ts="${ts}">${pad(d.getHours())}:${pad(d.getMinutes())}</button>`;
    })
    .join("");
}

function renderCalendar(): void {
  const box = el<HTMLElement>("ws-cal");
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const first = earliestDate();
  const firstMonth = first ? new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1) : new Date(year, month, 1);
  const lastDay = new Date(maxPickupTs());
  const lastMonth = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
  const viewMonth = new Date(year, month, 1);
  const canPrev = viewMonth.getTime() > firstMonth.getTime();
  const canNext = viewMonth.getTime() < lastMonth.getTime();

  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // тиждень з понеділка
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayValue = toDateInputValue(new Date());

  const cells: string[] = [];
  for (let i = 0; i < offset; i += 1) cells.push(`<span class="cal__cell cal__cell--empty"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = toDateInputValue(new Date(year, month, day));
    const available = slotsForDate(value).length > 0;
    const cls = [
      "cal__day",
      value === pickupDate ? "is-selected" : "",
      value === todayValue ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(
      `<button type="button" class="${cls}" data-date="${value}"${available ? "" : " disabled"} aria-label="${day}">${day}</button>`
    );
  }

  const arrow = (dir: "prev" | "next", enabled: boolean): string =>
    `<button type="button" class="cal__nav" data-nav="${dir}"${enabled ? "" : " disabled"} aria-label="${dir === "prev" ? "Попередній місяць" : "Наступний місяць"}">
       <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${dir === "prev" ? "M15 6L9 12L15 18" : "M9 6L15 12L9 18"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
     </button>`;

  box.innerHTML = `
    <div class="cal__head">
      ${arrow("prev", canPrev)}
      <span class="cal__title">${escapeHtml(monthTitle(viewMonth))}</span>
      ${arrow("next", canNext)}
    </div>
    <div class="cal__weekdays">${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="cal__grid">${cells.join("")}</div>`;
}

function setupPickupForm(): void {
  const first = earliestDate();
  pickupDate = "";
  pickupTs = null;
  calendarMonth = first ? new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1) : new Date();

  el<HTMLElement>("ws-earliest").innerHTML = first
    ? `Замовлення готуємо наперед: найближчий самовивіз — <strong>${escapeHtml(formatPickup(slotsForDate(first)[0]))}</strong>.`
    : "На жаль, зараз немає вільних слотів для самовивозу.";

  el<HTMLElement>("ws-cal").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const nav = target.closest<HTMLButtonElement>("[data-nav]");
    if (nav && !nav.disabled) {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + (nav.dataset.nav === "next" ? 1 : -1), 1);
      renderCalendar();
      return;
    }
    const day = target.closest<HTMLButtonElement>("[data-date]");
    if (day && !day.disabled && day.dataset.date) setPickupDate(day.dataset.date);
  });

  el<HTMLElement>("ws-slots").addEventListener("click", (e) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>("[data-ts]");
    if (!slot?.dataset.ts) return;
    pickupTs = Number(slot.dataset.ts);
    renderSlots();
    updateSubmitState();
  });

  setPickupDate(first ?? "");

  if (currentUser) el<HTMLInputElement>("ws-phone").value = currentUser.phone;
}

function showMessage(text: string, isError: boolean): void {
  const box = el<HTMLElement>("ws-message");
  box.textContent = text;
  box.classList.toggle("form-message--visible", text.length > 0 && !isError);
  box.style.display = text.length > 0 ? "block" : "none";
  if (isError) {
    box.style.background = "var(--color-error-bg)";
    box.style.color = "var(--color-error)";
  } else {
    box.style.background = "";
    box.style.color = "";
  }
}

async function postWholesaleOrder(body: unknown): Promise<WholesaleResult> {
  try {
    const res = await fetch("/api/orders/wholesale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return (await res.json()) as WholesaleResult;
  } catch {
    return { ok: false, error: "Немає з'єднання із сервером. Спробуйте ще раз." };
  }
}

async function submitOrder(): Promise<void> {
  const pickupAt = selectedPickupTs();
  if (pickupAt === null) return;

  const phone = el<HTMLInputElement>("ws-phone").value.trim();
  if (!/^\+?\d{9,13}$/.test(phone.replace(/[\s()-]/g, ""))) {
    showMessage("Вкажіть коректний номер телефону", true);
    return;
  }

  const items = [...quantities.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([id, quantity]) => ({ productId: Number(id), quantity }));

  const btn = el<HTMLButtonElement>("ws-submit");
  btn.disabled = true;
  showMessage("", false);

  const result = await postWholesaleOrder({
    items,
    pickupAt,
    contactPhone: phone,
    comment: el<HTMLTextAreaElement>("ws-comment").value,
  });

  if (!result.ok || !result.order) {
    showMessage(result.error ?? "Не вдалось оформити замовлення", true);
    updateSubmitState();
    return;
  }

  closeCheckout();
  renderDone(result.order, result.volumeDiscountPercent ?? 0, result.subtotal ?? result.order.totalAmount);
}

// ---------- екрани стану ----------

function renderDone(order: ApiOrder, volumePercent: number, subtotal: number): void {
  const saved = Math.round((subtotal - order.totalAmount) * 100) / 100;
  const pieces = order.items.reduce((acc, i) => acc + i.quantity, 0);
  const itemsHtml = order.items
    .map(
      (i) => `
        <li class="ws-ticket__item">
          <span class="ws-ticket__item-name">${escapeHtml(i.productName)}</span>
          <span class="ws-ticket__item-qty">${i.quantity} шт.</span>
          <span class="ws-ticket__item-sum">${formatMoney(i.priceAtPurchase * i.quantity)}</span>
        </li>`
    )
    .join("");

  getRoot().innerHTML = `
    <section class="ws-ticket">
      <div class="ws-ticket__hero">
        <span class="ws-ticket__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <h1 class="ws-ticket__title">Замовлення прийнято</h1>
        <p class="ws-ticket__sub">№${order.id} · ми вже почали планувати виробництво</p>
      </div>

      <div class="ws-ticket__facts">
        <div class="ws-fact">
          <span class="ws-fact__label">Самовивіз</span>
          <span class="ws-fact__value">${escapeHtml(formatPickup(order.pickupAt ?? Date.now()))}</span>
        </div>
        <div class="ws-fact">
          <span class="ws-fact__label">Склад</span>
          <span class="ws-fact__value">${order.items.length} поз. · ${pieces} шт.</span>
        </div>
        <div class="ws-fact ws-fact--total">
          <span class="ws-fact__label">До сплати</span>
          <span class="ws-fact__value">${formatMoney(order.totalAmount)}</span>
          ${saved > 0 ? `<span class="ws-fact__save">Знижка −${volumePercent}% · ви економите ${formatMoney(saved)}</span>` : ""}
        </div>
      </div>

      <ol class="ws-steps" aria-label="Що далі">
        <li class="ws-steps__item is-done"><span class="ws-steps__dot">1</span><span>Замовлення прийнято</span></li>
        <li class="ws-steps__item"><span class="ws-steps__dot">2</span><span>Підтвердимо й приготуємо</span></li>
        <li class="ws-steps__item"><span class="ws-steps__dot">3</span><span>Видача у вказаний час</span></li>
      </ol>

      <details class="ws-ticket__details">
        <summary>Склад замовлення</summary>
        <ul class="ws-ticket__list">${itemsHtml}</ul>
      </details>

      <p class="ws-ticket__note">Статус можна відстежувати в меню профілю → «Мої замовлення».</p>

      <div class="ws-done__actions">
        <button type="button" class="btn btn--primary-sm" id="ws-new-order">Нове замовлення</button>
        <a class="btn btn--ghost" href="index.html">Звичайний каталог</a>
      </div>
    </section>`;
  el<HTMLButtonElement>("ws-new-order").addEventListener("click", () => {
    quantities.clear();
    searchQuery = "";
    activeCategory = "all";
    onlySelected = false;
    mountOrderPage();
  });
  window.scrollTo({ top: 0 });
}

function renderNotWholesale(): void {
  getRoot().innerHTML = `
    <section class="ws-done">
      <h1 class="ws-title">Сторінка для оптових покупців</h1>
      <p class="ws-lead">Ваш акаунт зареєстровано як звичайного покупця. Оформити замовлення можна в основному каталозі.</p>
      <div class="ws-done__actions">
        <a class="btn btn--primary-sm" href="index.html">До каталогу</a>
      </div>
    </section>`;
}

// ---------- збірка сторінки ----------

function mountOrderPage(): void {
  renderShell();
  renderRows();
  setupPickupForm();
  updateSummary();

  el<HTMLInputElement>("ws-search").addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderRows();
  });

  el<HTMLElement>("ws-chips").addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-cat]");
    if (!chip) return;
    activeCategory = chip.dataset.cat ?? "all";
    el<HTMLElement>("ws-chips").innerHTML = chipsHtml();
    renderRows();
  });

  el<HTMLInputElement>("ws-only-selected").addEventListener("change", (e) => {
    onlySelected = (e.target as HTMLInputElement).checked;
    renderRows();
  });

  const rows = el<HTMLElement>("ws-rows");

  rows.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ws-row");
    if (!btn || !row?.dataset.id) return;
    const id = row.dataset.id;
    const current = quantities.get(id) ?? 0;
    if (btn.dataset.act === "inc") setQty(id, current === 0 ? config.minQtyPerItem : current + 1);
    else if (btn.dataset.act === "dec") setQty(id, current <= config.minQtyPerItem ? 0 : current - 1);
    else if (btn.dataset.act === "quick") setQty(id, current + QUICK_STEP);
  });

  rows.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    const row = input.closest<HTMLElement>(".ws-row");
    if (!row?.dataset.id || !input.classList.contains("ws-qty__input")) return;
    const digits = input.value.replace(/\D/g, "").slice(0, 6);
    input.value = digits;
    setQty(row.dataset.id, digits ? Number(digits) : 0);
  });

  // Після виходу з поля вирівнюємо текст із реальним значенням
  // (напр. "007" → "7", обрізане до ліміту).
  rows.addEventListener("focusout", (e) => {
    const input = e.target as HTMLInputElement;
    const row = input.closest<HTMLElement>(".ws-row");
    if (!row?.dataset.id || !input.classList.contains("ws-qty__input")) return;
    updateRow(row.dataset.id);
  });

  el<HTMLButtonElement>("ws-submit").addEventListener("click", () => {
    void submitOrder();
  });

  el<HTMLButtonElement>("ws-open").addEventListener("click", openCheckout);
  el<HTMLButtonElement>("ws-bar-go").addEventListener("click", () => {
    if (totals().belowMin > 0) {
      el<HTMLElement>("ws-summary").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    openCheckout();
  });

  el<HTMLElement>("ws-checkout").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-close]")) closeCheckout();
  });
  setupSwipeToClose(el<HTMLElement>("ws-checkout-panel"), el<HTMLElement>("ws-checkout-handle"), closeCheckout);

  if (!escapeBound) {
    escapeBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && checkoutOpen) closeCheckout();
    });
  }

}

async function loadConfig(): Promise<void> {
  try {
    const res = await fetch("/api/wholesale/config");
    if (!res.ok) return;
    const data = (await res.json()) as Partial<WholesaleConfig> & { ok?: boolean };
    if (!data.ok) return;
    config = {
      minLeadHours: data.minLeadHours ?? config.minLeadHours,
      maxDaysAhead: data.maxDaysAhead ?? config.maxDaysAhead,
      firstHour: data.firstHour ?? config.firstHour,
      lastHour: data.lastHour ?? config.lastHour,
      minQtyPerItem: data.minQtyPerItem ?? config.minQtyPerItem,
      discountTiers: data.discountTiers ?? config.discountTiers,
      maxTotalDiscount: data.maxTotalDiscount ?? config.maxTotalDiscount,
    };
  } catch {
    // Лишаємо значення за замовчуванням — сервер усе одно перевірить час.
  }
}

function renderAuthSlot(session: SessionUser): void {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;
  slot.innerHTML = userMenuHtml(session);
  document.getElementById("logout-btn")?.addEventListener("click", () => {
    void (async () => {
      await logout();
      window.location.href = "index.html";
    })();
  });
  setupUserMenu();
}

async function init(): Promise<void> {
  const session = await getSession();

  if (!session) {
    window.location.href = "index.html?auth=login";
    return;
  }
  if (session.role === "admin") {
    window.location.href = "admin.html";
    return;
  }

  currentUser = session;
  renderAuthSlot(session);

  if (session.customerType !== "wholesale") {
    renderNotWholesale();
    return;
  }

  await Promise.all([loadProducts(), loadConfig(), getCategories().then((c) => (categories = c))]);
  mountOrderPage();
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
