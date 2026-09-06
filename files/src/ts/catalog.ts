import { CATEGORIES, PRODUCTS, type Product } from "./products.js";
import {
  addToCart,
  subscribeCart,
  setQty,
  getCartItems,
  getCartTotal,
  getCartCount,
  type CartItem,
} from "./cart.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { setupSwipeToClose } from "./swipe-sheet.js";

const CURRENCY = "₴";

let activeCategory = "all";
let searchQuery = "";

function renderCategories(): void {
  const list = document.getElementById("categories-list");
  if (!list) return;

  list.innerHTML = CATEGORIES.map(
    (c) =>
      `<button class="categories__item${
        c.id === activeCategory ? " categories__item--active" : ""
      }" type="button" data-category="${c.id}">${c.name}</button>`
  ).join("");

  list.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category ?? "all";
      renderCategories();
      renderProducts();
      // Щоб одразу було видно початок нової добірки, а не той самий
      // рядок прокрутки, на якому застали попередню категорію.
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function productCardHtml(p: Product): string {
  return `
    <article class="product-card" data-product-id="${p.id}">
      <div class="product-card__image-wrap">
        <div class="product-card__image" aria-hidden="true">${p.emoji}</div>
        <div class="product-card__control">
          <button class="product-card__plus" type="button" data-add="${p.id}" aria-label="Додати">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="product-card__stepper is-hidden" data-stepper="${p.id}">
            <button type="button" data-minus="${p.id}" aria-label="Менше">−</button>
            <span class="product-card__qty" data-qty-display="${p.id}">1</span>
            <button type="button" data-plus="${p.id}" aria-label="Більше">+</button>
          </div>
        </div>
      </div>
      <div class="product-card__info">
        <div class="product-card__price">${p.price} ${CURRENCY}</div>
        <h3 class="product-card__name">${p.name}</h3>
      </div>
    </article>`;
}

// Час, за який встигає доіграти CSS-анімація зникнення рядка (нижче,
// .cart-item--exit) — доки вона не дограє, реальне видалення зі стану
// кошика (і, відповідно, перерендер без цього рядка) відкладаємо.
const EXIT_ANIMATION_MS = 180;

// Спільна логіка "спочатку програти анімацію зникнення рядка в кошику,
// і лише потім реально прибрати товар зі стану" — використовується як
// зі степпера ВСЕРЕДИНІ кошика, так і зі степпера НА САМІЙ картці
// товару в каталозі (раніше анімація зникнення працювала лише в
// першому випадку, бо ця перевірка була захардкоджена тільки в
// bindQtyButtons; тепер обидва шляхи ведуть до одного й того самого
// коду). Шукаємо рядок одразу в ОБОХ контейнерах (десктопна панель і
// мобільна шторка) через спільний data-атрибут — той, що зараз не
// показаний користувачу, просто не знайдеться і буде пропущений.
function removeFromCartAnimated(id: string): void {
  const rows = document.querySelectorAll<HTMLElement>(`[data-cart-item="${id}"]`);
  if (rows.length === 0) {
    setQty(id, 0);
    return;
  }
  rows.forEach((row) => row.classList.add("cart-item--exit"));
  window.setTimeout(() => setQty(id, 0), EXIT_ANIMATION_MS);
}

function bindProductCardEvents(grid: HTMLElement): void {
  // Уся картка клікабельна — веде на сторінку товару (поки заглушка).
  // Кнопки всередині картки (додати/степпер) мають своя власна дія і
  // зупиняють клік, щоб не спрацьовував ще й перехід на сторінку.
  grid.querySelectorAll<HTMLElement>(".product-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.productId;
      if (id) window.location.href = `product.html?id=${encodeURIComponent(id)}`;
    });
  });

  grid.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const product = PRODUCTS.find((p) => p.id === btn.dataset.add);
      if (product) addToCart(product);
    });
  });
  grid.querySelectorAll<HTMLButtonElement>("[data-minus]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.minus;
      const item = getCartItems().find((i) => i.productId === id);
      if (!id || !item) return;
      if (item.qty <= 1) {
        removeFromCartAnimated(id);
      } else {
        setQty(id, item.qty - 1);
      }
    });
  });
  grid.querySelectorAll<HTMLButtonElement>("[data-plus]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.plus;
      const item = getCartItems().find((i) => i.productId === id);
      if (id && item) setQty(id, item.qty + 1);
    });
  });
}

// Синхронізує кожну картку товару на екрані з поточним станом кошика:
// показує "+" або пігулку-степпер із актуальною кількістю. Викликається
// і одразу після рендеру карток (щоб не було "миготіння" не того стану
// при перемиканні категорій), і на кожну зміну кошика (щоб, наприклад,
// зміна кількості з панелі кошика одразу відбилась і на картці товару).
function syncProductControls(items: CartItem[]): void {
  document.querySelectorAll<HTMLElement>(".product-card").forEach((card) => {
    const id = card.dataset.productId;
    if (!id) return;
    const item = items.find((i) => i.productId === id);
    const plusBtn = card.querySelector<HTMLElement>(".product-card__plus");
    const stepper = card.querySelector<HTMLElement>(".product-card__stepper");
    const qtyDisplay = card.querySelector<HTMLElement>("[data-qty-display]");

    if (item) {
      plusBtn?.classList.add("is-hidden");
      stepper?.classList.remove("is-hidden");
      if (qtyDisplay) qtyDisplay.textContent = String(item.qty);
    } else {
      stepper?.classList.add("is-hidden");
      plusBtn?.classList.remove("is-hidden");
    }
  });
}

function renderProducts(): void {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const query = searchQuery.trim().toLowerCase();
  let filtered: Product[];

  if (query) {
    // Пошук іде по ВСІХ товарах, незалежно від обраної категорії —
    // логічно, що людина, яка щось шукає, хоче побачити геть усі
    // збіги, а не тільки в межах поточної вкладки.
    filtered = PRODUCTS.filter((p) => p.name.toLowerCase().includes(query));
  } else {
    filtered = activeCategory === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.category === activeCategory);
  }

  grid.innerHTML = filtered.length
    ? filtered.map(productCardHtml).join("")
    : `<p class="products-empty">Нічого не знайдено 🤷</p>`;
  bindProductCardEvents(grid);
  syncProductControls(getCartItems());
}

// Викликається з полів пошуку в шапці (десктоп) і знизу (мобілка) —
// див. setupSearchInputs у main.ts.
export function setSearchQuery(query: string): void {
  searchQuery = query;
  renderProducts();
}

function cartItemHtml(item: CartItem, isNew: boolean): string {
  return `
    <li class="cart-item${isNew ? " cart-item--enter" : ""}" data-cart-item="${item.productId}">
      <div class="cart-item__image" aria-hidden="true">${item.emoji}</div>
      <div class="cart-item__info">
        <span class="cart-item__name">${item.name}</span>
        <span class="cart-item__price">${item.price} ${CURRENCY}</span>
      </div>
      <div class="cart-item__qty">
        <button type="button" data-qty-minus="${item.productId}" aria-label="Менше">−</button>
        <span>${item.qty}</span>
        <button type="button" data-qty-plus="${item.productId}" aria-label="Більше">+</button>
      </div>
    </li>`;
}

// Кнопки +/− усередині самого кошика — той самий removeFromCartAnimated
// вище відповідає і за коректне зникнення тут.
function bindQtyButtons(container: HTMLElement, items: CartItem[]): void {
  container.querySelectorAll<HTMLButtonElement>("[data-qty-minus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.qtyMinus;
      const item = items.find((i) => i.productId === id);
      if (!id || !item) return;

      if (item.qty <= 1) {
        removeFromCartAnimated(id);
        return;
      }

      setQty(id, item.qty - 1);
    });
  });
  container.querySelectorAll<HTMLButtonElement>("[data-qty-plus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.qtyPlus;
      const item = items.find((i) => i.productId === id);
      if (id && item) setQty(id, item.qty + 1);
    });
  });
}

function renderCartBody(container: HTMLElement, items: CartItem[], newIds: Set<string>): void {
  container.innerHTML = items.length
    ? `<ul class="cart-list">${items.map((i) => cartItemHtml(i, newIds.has(i.productId))).join("")}</ul>`
    : `<div class="cart-empty"><span class="cart-empty__icon" aria-hidden="true">🧺</span>Кошик порожній.<br />Додайте щось смачне 🙂</div>`;
  bindQtyButtons(container, items);
}

// Ід товарів, що вже були в кошику на МОМЕНТ попереднього рендеру —
// потрібно, щоб при наступному оновленні зрозуміти, які рядки з'явились
// щойно (і програти для них анімацію появи), а які просто змінили
// кількість (і не блимати зайвий раз).
let previousCartIds = new Set<string>();

function renderCart(items: CartItem[]): void {
  syncProductControls(items);

  const newIds = new Set(items.map((i) => i.productId).filter((id) => !previousCartIds.has(id)));

  const count = getCartCount();
  document.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
    el.classList.toggle("is-visible", count > 0);
  });

  const totalText = `${getCartTotal()} ${CURRENCY}`;

  const panelBody = document.getElementById("cart-panel-body");
  if (panelBody) renderCartBody(panelBody, items, newIds);
  const panelTotal = document.getElementById("cart-total");
  if (panelTotal) panelTotal.textContent = totalText;
  const panelCheckout = document.getElementById("cart-checkout-btn") as HTMLButtonElement | null;
  if (panelCheckout) panelCheckout.disabled = items.length === 0;

  const mobileBody = document.getElementById("mobile-cart-body");
  if (mobileBody) renderCartBody(mobileBody, items, newIds);
  const mobileTotal = document.getElementById("mobile-cart-total");
  if (mobileTotal) mobileTotal.textContent = totalText;
  const mobileCheckout = document.getElementById("mobile-cart-checkout-btn") as HTMLButtonElement | null;
  if (mobileCheckout) mobileCheckout.disabled = items.length === 0;

  previousCartIds = new Set(items.map((i) => i.productId));
}

// ---- Мобільна шторка кошика (той самий overlay-патерн, що й у
// auth-modal.ts, тільки виїжджає знизу, а не спливає по центру). ----

function onSheetKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMobileCartSheet();
}

function openMobileCartSheet(): void {
  const sheet = document.getElementById("mobile-cart-sheet");
  if (!sheet) return;
  sheet.classList.add("mobile-cart-sheet--open");
  sheet.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onSheetKeydown);
}

function closeMobileCartSheet(): void {
  const sheet = document.getElementById("mobile-cart-sheet");
  if (!sheet) return;
  sheet.classList.remove("mobile-cart-sheet--open");
  sheet.setAttribute("aria-hidden", "true");
  unlockScroll();
  document.removeEventListener("keydown", onSheetKeydown);
}

function setupMobileCartSheet(): void {
  document.getElementById("mobile-cart-button")?.addEventListener("click", openMobileCartSheet);
  document.getElementById("mobile-cart-sheet-close")?.addEventListener("click", closeMobileCartSheet);
  document.getElementById("mobile-cart-sheet-backdrop")?.addEventListener("click", closeMobileCartSheet);
}

// Свайп по "ручці" шторки вниз — закриває її. Раніше сама ручка була
// зовсім тонкою смужкою (40×4px) — влучити по ній пальцем було складно,
// тож свайп ніби "не працював". Реальна область дотику тепер значно
// більша (див. .mobile-cart-sheet__handle-hit у layout.css), сама
// смужка лишається тонкою тільки візуально.
function setupSheetSwipeToClose(): void {
  const panel = document.querySelector<HTMLElement>(".mobile-cart-sheet__panel");
  const handleHit = document.querySelector<HTMLElement>(".mobile-cart-sheet__handle-hit");
  if (!panel || !handleHit) return;
  setupSwipeToClose(panel, handleHit, closeMobileCartSheet);
}

// Кількість "скелетів" карток товару на час імітованого завантаження —
// орієнтовно стільки поміститься на екран одразу, без зайвого скролу.
const SKELETON_COUNT = 8;
// Наразі товари локальні (PRODUCTS у products.ts) — реальної затримки
// мережі тут немає. Коли каталог переїде на backend (як і auth свого
// часу), це значення можна просто прибрати — скелетони самі почнуть
// відповідати реальному часу завантаження.
const SKELETON_DELAY_MS = 450;

function skeletonCardHtml(): string {
  return `
    <div class="product-card product-card--skeleton" aria-hidden="true">
      <div class="skeleton skeleton--image"></div>
      <div class="product-card__info">
        <div class="skeleton skeleton--line skeleton--price"></div>
        <div class="skeleton skeleton--line skeleton--name"></div>
      </div>
    </div>`;
}

function renderProductSkeletons(): void {
  const grid = document.getElementById("products-grid");
  if (!grid) return;
  grid.innerHTML = Array.from({ length: SKELETON_COUNT }, skeletonCardHtml).join("");
}

export function setupCatalog(): void {
  renderCategories();
  // Спочатку — скелетони з "переливом" (як у YouTube/Яндекс Лавці), і
  // тільки після невеликої паузи — реальні картки. Суто для відчуття
  // "щось вантажиться", а не миттєвий стрибок порожньо→повно.
  renderProductSkeletons();
  window.setTimeout(renderProducts, SKELETON_DELAY_MS);
  subscribeCart(renderCart);
  setupMobileCartSheet();
  setupSheetSwipeToClose();
}
