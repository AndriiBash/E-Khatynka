import { PRODUCTS, loadProducts, refreshProducts, type Product } from "./products.js";
import { getCategories, getSession, placeOrder, getMyPaymentMethods, type MyPaymentMethod } from "./storage.js";
import type { ApiCategory } from "./types.js";
import {
  addToCart,
  subscribeCart,
  setQty,
  clearCart,
  getCartItems,
  getCartTotal,
  getCartOriginalTotal,
  getCartDiscountTotal,
  getCartCount,
  loadCart,
  type CartItem,
} from "./cart.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { setupSwipeToClose } from "./swipe-sheet.js";
import { openAuthModal } from "./auth-modal.js";

const CURRENCY = "₴";

let activeCategory = "all";
let searchQuery = "";
let dynamicCategories: ApiCategory[] = [];

function categoryIconHtml(iconUrl: string | null): string {
  if (!iconUrl) return "";
  // onerror="this.remove()" — щоб биту/ще не завантажену адміном
  // іконку не бачити порожньою рамкою, а просто лишити текстову назву.
  return `<img class="categories__item-icon" src="${iconUrl}" alt="" aria-hidden="true" onerror="this.remove()" />`;
}

const DEFAULT_HERO_SUBTITLE = "Свіжа випічка щодня — обирайте категорію зліва або гортайте весь каталог.";

function updateHeroSubtitle(): void {
  const subtitle = document.getElementById("hero-subtitle");
  if (!subtitle) return;

  const category = dynamicCategories.find((c) => String(c.id) === activeCategory);
  subtitle.textContent = category?.description || DEFAULT_HERO_SUBTITLE;
}

function renderCategories(): void {
  const list = document.getElementById("categories-list");
  if (!list) return;

  // "Усі товари" — псевдокатегорія, живе лише на клієнті (немає рядка
  // в БД), решта — те, що адмін реально додав через /api/admin/categories.
  const items: Array<{ id: string; name: string; iconUrl: string | null }> = [
    { id: "all", name: "Усі товари", iconUrl: null },
    ...dynamicCategories.map((c) => ({ id: String(c.id), name: c.name, iconUrl: c.iconUrl })),
  ];

  list.innerHTML = items
    .map(
      (c) =>
        `<button class="categories__item${
          c.id === activeCategory ? " categories__item--active" : ""
        }" type="button" data-category="${c.id}">${categoryIconHtml(c.iconUrl)}<span>${c.name}</span></button>`
    )
    .join("");

  list.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category ?? "all";
      // Той самий баг, що був у адмінській таблиці категорій: повний
      // innerHTML наново пересоздавав усі <img> іконки списку, тож вони
      // на мить зникали й підвантажувались заново при кожному виборі
      // категорії. Замість повного renderCategories() — просто
      // перемикаємо клас "активний" на кнопках, іконки лишаються тими
      // самими DOM-вузлами.
      highlightActiveCategory();
      renderProducts();
      updateHeroSubtitle();
      // Щоб одразу було видно початок нової добірки, а не той самий
      // рядок прокрутки, на якому застали попередню категорію.
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function highlightActiveCategory(): void {
  const list = document.getElementById("categories-list");
  if (!list) return;
  list.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((btn) => {
    btn.classList.toggle("categories__item--active", btn.dataset.category === activeCategory);
  });
}

async function loadCategories(): Promise<void> {
  dynamicCategories = await getCategories();
  renderCategories();
  // Категорію могли вже обрати (не мало б статись до першого
  // завантаження списку, але про всяк випадок) — і опис міг щойно
  // "приїхати" разом із самим списком категорій.
  updateHeroSubtitle();
}

function productImageHtml(p: Product): string {
  if (p.imageUrl) {
    // onerror — та сама страховка, що й іконки категорій/тегів в
    // адмінці: бита чи ще не завантажена картинка не лишає порожню
    // рамку, просто відкочується до емодзі-заглушки.
    return `<img class="product-card__photo" src="${p.imageUrl}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: 'product-card__image', textContent: '${p.emoji}'}))" />`;
  }
  return `<div class="product-card__image" aria-hidden="true">${p.emoji}</div>`;
}

function productPriceHtml(p: Product): string {
  if (p.discountPercent > 0 && p.originalPrice > p.price) {
    return `
      <div class="product-card__price-row">
        <span class="product-card__price product-card__price--sale">${p.price} ${CURRENCY}</span>
        <span class="product-card__price-old">${p.originalPrice} ${CURRENCY}</span>
      </div>`;
  }
  return `<div class="product-card__price">${p.price} ${CURRENCY}</div>`;
}

function discountBadgeHtml(p: Product): string {
  if (p.discountPercent > 0 && p.originalPrice > p.price) {
    return `<span class="product-card__badge">−${p.discountPercent}%</span>`;
  }
  return "";
}

function productCardHtml(p: Product): string {
  return `
    <article class="product-card" data-product-id="${p.id}">
      <div class="product-card__image-wrap">
        ${productImageHtml(p)}
        ${discountBadgeHtml(p)}
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
        ${productPriceHtml(p)}
        <h3 class="product-card__name">${p.name}</h3>
      </div>
    </article>`;
}

// Час, за який встигає доіграти CSS-анімація зникнення рядка (нижче,
// .cart-item--exit) — доки вона не дограє, реальне видалення зі стану
// кошика (і, відповідно, перерендер без цього рядка) відкладаємо.
const EXIT_ANIMATION_MS = 200;

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
  // Один делегований listener на весь грід замість querySelectorAll+
  // addEventListener на кожен елемент — раніше цю функцію викликали
  // заново після КОЖНОГО renderProducts() (у тому числі на кожне
  // натискання клавіші під час пошуку), і при повторному виклику на
  // тих самих (не пересозданих — дивись reconcileProductCards нижче)
  // кнопках навішувались ще одні й ще одні обробники, тож клік
  // спрацьовував по кілька разів. Делегування вішається РІВНО ОДИН РАЗ
  // на сам контейнер (data-bound), він переживає будь-яку кількість
  // подальших рендерів вмісту.
  if (grid.dataset.bound === "1") return;
  grid.dataset.bound = "1";

  grid.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const addBtn = target.closest<HTMLButtonElement>("[data-add]");
    if (addBtn) {
      e.stopPropagation();
      if (addBtn.disabled) return;
      const product = PRODUCTS.find((p) => p.id === addBtn.dataset.add);
      if (product) addToCart(product);
      return;
    }

    const minusBtn = target.closest<HTMLButtonElement>("[data-minus]");
    if (minusBtn) {
      e.stopPropagation();
      const id = minusBtn.dataset.minus;
      const item = getCartItems().find((i) => i.productId === id);
      if (!id || !item) return;
      if (item.qty <= 1) {
        removeFromCartAnimated(id);
      } else {
        setQty(id, item.qty - 1);
      }
      return;
    }

    const plusBtn = target.closest<HTMLButtonElement>("[data-plus]");
    if (plusBtn) {
      e.stopPropagation();
      if (plusBtn.disabled) return;
      const id = plusBtn.dataset.plus;
      const item = getCartItems().find((i) => i.productId === id);
      if (id && item) setQty(id, item.qty + 1);
      return;
    }

    // Уся картка клікабельна — веде на сторінку товару (кнопки вище
    // вже зупинили б клік через return, сюди він доходить лише коли
    // клікнули поза ними).
    const card = target.closest<HTMLElement>(".product-card");
    if (card) {
      const id = card.dataset.productId;
      if (id) window.location.href = `product.html?id=${encodeURIComponent(id)}`;
    }
  });
}

// Синхронізує кожну картку товару на екрані з поточним станом кошика:
// показує "+" або пігулку-степпер із актуальною кількістю. Викликається
// і одразу після рендеру карток (щоб не було "миготіння" не того стану
// при перемиканні категорій), і на кожну зміну кошика (щоб, наприклад,
// зміна кількості з панелі кошика одразу відбилась і на картці товару).
//
// Тут-таки — обмеження "не більше, ніж є на складі": кнопка "+" (і
// "+" усередині степпера) стає неактивною/сірою, щойно кількість у
// кошику досягає stockQuantity товару, і повертається до звичайного
// стану, щойно кількість знову менша за залишок (наприклад, після
// зменшення степпером) — цей стан рахується наново при кожному виклику,
// а не встановлюється один раз, тож "забути повернути" йому нема як.
function syncProductControls(items: CartItem[]): void {
  document.querySelectorAll<HTMLElement>(".product-card").forEach((card) => {
    const id = card.dataset.productId;
    if (!id) return;
    const product = PRODUCTS.find((p) => p.id === id);
    const item = items.find((i) => i.productId === id);
    const plusBtn = card.querySelector<HTMLButtonElement>(".product-card__plus");
    const stepper = card.querySelector<HTMLElement>(".product-card__stepper");
    const stepperPlusBtn = card.querySelector<HTMLButtonElement>("[data-plus]");
    const qtyDisplay = card.querySelector<HTMLElement>("[data-qty-display]");

    const stock = product?.stockQuantity ?? Infinity;
    const qty = item?.qty ?? 0;
    const atMax = qty >= stock;

    if (item) {
      plusBtn?.classList.add("is-hidden");
      stepper?.classList.remove("is-hidden");
      if (qtyDisplay) qtyDisplay.textContent = String(item.qty);
    } else {
      stepper?.classList.add("is-hidden");
      plusBtn?.classList.remove("is-hidden");
    }

    if (plusBtn) plusBtn.disabled = atMax;
    if (stepperPlusBtn) stepperPlusBtn.disabled = atMax;
  });
}

// Реконсиляція карток товару в гріді — той самий принцип, що
// reconcileTableRows в admin.ts (дивись коментар там): пошук
// перерендерює грід на кожне натискання клавіші (renderProducts()
// нижче), і повний innerHTML щоразу пересоздавав усі картки разом з
// їхніми <img> фото — вони на мить зникали й підвантажувались заново
// (видиме "миготіння"), навіть коли сам набір карток, що лишились
// після фільтра, не змінювався. Картки з тим самим data-product-id
// тепер переносяться (не пересоздаються), нові — вставляються на своє
// місце, зниклі — прибираються.
function reconcileProductCards(grid: HTMLElement, newHtml: string): void {
  const temp = document.createElement("div");
  temp.innerHTML = newHtml;
  const newCards = Array.from(temp.children) as HTMLElement[];

  const oldById = new Map<string, HTMLElement>();
  Array.from(grid.children).forEach((el) => {
    const id = (el as HTMLElement).dataset.productId;
    if (id) oldById.set(id, el as HTMLElement);
  });

  const usedIds = new Set<string>();

  newCards.forEach((newCard, index) => {
    const id = newCard.dataset.productId;
    const oldCard = id ? oldById.get(id) : undefined;
    const refNode = grid.children[index] ?? null;

    if (oldCard) {
      usedIds.add(id as string);
      if (oldCard !== refNode) grid.insertBefore(oldCard, refNode);
      // Сама картка (фото/степпер) не чіпається — лишень інфо-блок
      // (ціна/назва) патчиться, якщо реально відрізняється, на випадок
      // якщо дані товару (знижка тощо) встигли змінитись між рендерами.
      const oldInfo = oldCard.querySelector(".product-card__info");
      const newInfo = newCard.querySelector(".product-card__info");
      if (oldInfo && newInfo && oldInfo.innerHTML !== newInfo.innerHTML) {
        oldInfo.innerHTML = newInfo.innerHTML;
      }
    } else {
      grid.insertBefore(newCard, refNode);
    }
  });

  oldById.forEach((el, id) => {
    if (!usedIds.has(id)) el.remove();
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

  // ВАЖЛИВО: перевіряємо саме [data-product-id], а не просто
  // ".product-card" — скелетони завантаження (renderProductSkeletons)
  // теж мають клас .product-card (щоб мати однаковий розмір), але без
  // data-product-id. Якщо перевіряти на сам клас, перший реальний
  // рендер після скелетонів помилково йшов гілкою "реконсиляція" —
  // reconcileProductCards шукає старі картки за id, скелетони під цю
  // умову не підпадають (в них немає id), тож жодного разу не
  // потрапляли в oldById і залишались в DOM непроприбраними назавжди:
  // саме це й було тим "підвантажується незрозуміло що" з бага —
  // 1 реальна картка товару поряд із 7 скелетонами, що так і не зникли.
  const hasExistingCards = grid.querySelector("[data-product-id]") !== null;
  if (filtered.length && hasExistingCards) {
    reconcileProductCards(grid, filtered.map(productCardHtml).join(""));
  } else {
    grid.innerHTML = filtered.length
      ? filtered.map(productCardHtml).join("")
      : `<p class="products-empty">Нічого не знайдено 🤷</p>`;
  }
  bindProductCardEvents(grid);
  syncProductControls(getCartItems());
}

// Викликається з полів пошуку в шапці (десктоп) і знизу (мобілка) —
// див. setupSearchInputs у main.ts.
export function setSearchQuery(query: string): void {
  const wasEmpty = searchQuery.trim().length === 0;
  searchQuery = query;
  renderProducts();
  // Скролимо нагору тільки в момент, коли пошук ЗАПОЧАТКОВУЄТЬСЯ
  // (порожньо → щось), а не на кожен символ — інакше сторінка смикалась
  // би при кожному натисканні клавіші, поки людина ще друкує запит.
  if (wasEmpty && query.trim().length > 0) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function cartItemImageHtml(item: CartItem): string {
  if (item.imageUrl) {
    return `<img class="cart-item__photo" src="${item.imageUrl}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: 'cart-item__image', textContent: '${item.emoji}'}))" />`;
  }
  return `<div class="cart-item__image" aria-hidden="true">${item.emoji}</div>`;
}

function cartItemHtml(item: CartItem, isNew: boolean): string {
  const atMax = item.qty >= item.stockQuantity;
  return `
    <li class="cart-item${isNew ? " cart-item--enter" : ""}" data-cart-item="${item.productId}">
      ${cartItemImageHtml(item)}
      <div class="cart-item__info">
        <span class="cart-item__name">${item.name}</span>
        <span class="cart-item__price">${item.price} ${CURRENCY}</span>
      </div>
      <div class="cart-item__qty">
        <button type="button" data-qty-minus="${item.productId}" aria-label="Менше">−</button>
        <span data-qty-value>${item.qty}</span>
        <button type="button" data-qty-plus="${item.productId}" aria-label="Більше"${atMax ? " disabled" : ""}>+</button>
      </div>
    </li>`;
}

// Той самий принцип делегування, що bindProductCardEvents у каталозі
// вище — вішається один раз на контейнер (десктопна панель і мобільна
// шторка мають кожна свій), переживає будь-яку кількість подальших
// renderCartBody(). getCartItems() береться на МОМЕНТ кліку (не той
// масив, що був переданий при першому виклику) — інакше після кількох
// рендерів делегований обробник бачив би застарілий стан кошика.
function setupCartQtyDelegation(container: HTMLElement): void {
  if (container.dataset.bound === "1") return;
  container.dataset.bound = "1";

  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const minusBtn = target.closest<HTMLButtonElement>("[data-qty-minus]");
    if (minusBtn) {
      const id = minusBtn.dataset.qtyMinus;
      const item = getCartItems().find((i) => i.productId === id);
      if (!id || !item) return;
      if (item.qty <= 1) {
        removeFromCartAnimated(id);
        return;
      }
      setQty(id, item.qty - 1);
      return;
    }

    const plusBtn = target.closest<HTMLButtonElement>("[data-qty-plus]");
    if (plusBtn) {
      if (plusBtn.disabled) return;
      const id = plusBtn.dataset.qtyPlus;
      const item = getCartItems().find((i) => i.productId === id);
      if (id && item) setQty(id, item.qty + 1);
    }
  });
}

// Реконсиляція рядків кошика — той самий принцип, що
// reconcileProductCards вище: збільшення кількості (+) перерендерює
// увесь список кошика, і повний innerHTML щоразу пересоздавав усі
// <li> разом з їхніми <img> фото товару — вони на мить зникали й
// підвантажувались заново (видиме "миготіння" іконки товару в кошику
// саме при зміні кількості, а не тільки при відкритті). Рядок з тим
// самим data-cart-item тепер переноситься (не пересоздається), в ньому
// патчиться лише цифра кількості й стан кнопки "+" — фото й назва не
// чіпаються взагалі.
function reconcileCartList(list: HTMLElement, newHtml: string): void {
  const temp = document.createElement("ul");
  temp.innerHTML = newHtml;
  const newItems = Array.from(temp.children) as HTMLElement[];

  const oldById = new Map<string, HTMLElement>();
  Array.from(list.children).forEach((el) => {
    const id = (el as HTMLElement).dataset.cartItem;
    if (id) oldById.set(id, el as HTMLElement);
  });

  const usedIds = new Set<string>();

  newItems.forEach((newItem, index) => {
    const id = newItem.dataset.cartItem;
    const oldItem = id ? oldById.get(id) : undefined;
    const refNode = list.children[index] ?? null;

    if (oldItem) {
      usedIds.add(id as string);
      if (oldItem !== refNode) list.insertBefore(oldItem, refNode);

      const oldQty = oldItem.querySelector("[data-qty-value]");
      const newQty = newItem.querySelector("[data-qty-value]");
      if (oldQty && newQty && oldQty.textContent !== newQty.textContent) {
        oldQty.textContent = newQty.textContent;
      }

      const oldPlus = oldItem.querySelector<HTMLButtonElement>("[data-qty-plus]");
      const newPlus = newItem.querySelector<HTMLButtonElement>("[data-qty-plus]");
      if (oldPlus && newPlus) oldPlus.disabled = newPlus.disabled;
    } else {
      list.insertBefore(newItem, refNode);
    }
  });

  oldById.forEach((el, id) => {
    if (!usedIds.has(id)) el.remove();
  });
}

function renderCartBody(container: HTMLElement, items: CartItem[], newIds: Set<string>): void {
  const listHtml = items.map((i) => cartItemHtml(i, newIds.has(i.productId))).join("");
  const existingList = container.querySelector<HTMLElement>(".cart-list");

  if (items.length && existingList) {
    reconcileCartList(existingList, listHtml);
  } else if (!items.length && container.querySelector(".cart-empty")) {
    // Кошик і був порожній, і лишається порожнім (напр. "Очистити"
    // натиснули на вже порожньому кошику, або клір спрацював двічі) —
    // НЕ чіпаємо DOM. Раніше цей випадок теж падав у гілку нижче й
    // щоразу пересоздавав .cart-empty (разом із її <img>), хоча вміст
    // виходив ідентичний — саме це й моргало на "долю секунди", коли
    // насправді міняти було нічого.
  } else {
    container.innerHTML = items.length
      ? `<ul class="cart-list">${listHtml}</ul>`
      : `<div class="cart-empty"><img class="cart-empty__icon" src="assets/images/empty-cart.png" alt="" aria-hidden="true" onerror="this.style.display='none'" />Кошик порожній.<br />Додайте щось смачне 🙂</div>`;
  }
  setupCartQtyDelegation(container);
}

// Ід товарів, що вже були в кошику на МОМЕНТ попереднього рендеру —
// потрібно, щоб при наступному оновленні зрозуміти, які рядки з'явились
// щойно (і програти для них анімацію появи), а які просто змінили
// кількість (і не блимати зайвий раз).
let previousCartIds = new Set<string>();
let previousCartHadItems: boolean | null = null;

// Плавна зміна тексту кнопки "Оформити"/"Додайте щось" — короткий
// провал прозорості, але ЛИШЕ коли міняється сам РЕЖИМ (порожньо ↔ є
// товари), а не при кожній зміні суми всередині одного режиму —
// інакше кнопка "блимала" б на кожен "+"/"−" в кошику.
//
// checkoutTextState зберігає "куди веде" незавершений перехід — БАГ,
// що був тут раніше: guard звірявся з btn.textContent напряму, а під
// час 120мс fade текст ще фізично старий. Якщо друге оновлення
// (напр. після входу в акаунт: спершу reset кошика в 0, одразу за ним
// підвантаження змердженого кошика з сервера) прилітало so, що НОВИЙ
// текст випадково збігався зі СТАРИМ (ще не застосованим) текстом —
// guard хибно казав "нема різниці, нічого робити" й виходив, лишаючи
// висіти перший, застарілий setTimeout. Той таймаут потім усе одно
// спрацьовував і перезаписував кнопку на застарілий текст — кнопка
// назавжди застрягала на "Додайте щось" навіть коли кошик був не
// порожній. Тепер звіряємось із ЦІЛЬОВИМ текстом переходу (а не з тим,
// що зараз намальовано), і будь-яке нове оновлення скасовує попередній
// незавершений таймаут перед тим, як щось вирішувати.
const checkoutTextState = new WeakMap<HTMLButtonElement, { timer: number; target: string }>();

function setCheckoutText(btn: HTMLButtonElement, text: string, modeChanged: boolean): void {
  const pending = checkoutTextState.get(btn);
  const currentTarget = pending ? pending.target : btn.textContent;
  if (currentTarget === text) return;

  if (pending) {
    window.clearTimeout(pending.timer);
    checkoutTextState.delete(btn);
  }

  if (!modeChanged) {
    btn.textContent = text;
    btn.classList.remove("is-updating");
    return;
  }

  btn.classList.add("is-updating");
  const timer = window.setTimeout(() => {
    btn.textContent = text;
    btn.classList.remove("is-updating");
    checkoutTextState.delete(btn);
  }, 120);
  checkoutTextState.set(btn, { timer, target: text });
}

function renderCart(items: CartItem[]): void {
  syncProductControls(items);

  const newIds = new Set(items.map((i) => i.productId).filter((id) => !previousCartIds.has(id)));
  const modeChanged = previousCartHadItems !== null && previousCartHadItems !== (items.length > 0);

  const count = getCartCount();
  document.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
    el.classList.toggle("is-visible", count > 0);
  });

  const totalText = `${getCartTotal()} ${CURRENCY}`;
  // Поки кошик порожній — без "0 ₴" на кнопці, це виглядало дивно.
  const checkoutText = items.length ? `Оформити · ${totalText}` : "Додайте щось";

  const panelBody = document.getElementById("cart-panel-body");
  if (panelBody) renderCartBody(panelBody, items, newIds);
  const panelCheckout = document.getElementById("cart-checkout-btn") as HTMLButtonElement | null;
  if (panelCheckout) {
    setCheckoutText(panelCheckout, checkoutText, modeChanged);
    panelCheckout.disabled = items.length === 0;
  }

  const mobileBody = document.getElementById("mobile-cart-body");
  if (mobileBody) renderCartBody(mobileBody, items, newIds);
  const mobileCheckout = document.getElementById("mobile-cart-checkout-btn") as HTMLButtonElement | null;
  if (mobileCheckout) {
    setCheckoutText(mobileCheckout, checkoutText, modeChanged);
    mobileCheckout.disabled = items.length === 0;
  }

  previousCartIds = new Set(items.map((i) => i.productId));
  previousCartHadItems = items.length > 0;
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
  document.removeEventListener("keydown", onSheetKeydown);
  // unlockScroll() синхронно повертає body в звичайний скрол —
  // ЯКЩО зробити це одразу, фон "стрибає" назад у свою позицію прямо
  // під час того, як сама шторка ще 0.25с їде вниз (transform), і це
  // виглядало як смикання/дрож при закритті. Чекаємо, доки анімація
  // закриття справді дограє.
  window.setTimeout(() => {
    unlockScroll();
  }, 260);
}

function setupMobileCartSheet(): void {
  document.getElementById("mobile-cart-button")?.addEventListener("click", openMobileCartSheet);
  document.getElementById("mobile-cart-sheet-close")?.addEventListener("click", closeMobileCartSheet);
  document.getElementById("mobile-cart-sheet-backdrop")?.addEventListener("click", closeMobileCartSheet);
}

// БАГ: якщо шторку кошика відкрили на мобільній ширині (реальний
// телефон, поворот екрана; чи просто вузьке вікно/devtools), а потім
// той самий таб став десктопним — сама шторка про це ніяк "не
// дізнається": показ/приховування керується лише класом
// mobile-cart-sheet--open, без @media (кнопка відкриття — так,
// .mobile-cart-button ховається на десктопі медіа-запитом, а от вже
// відкрита шторка лишається висіти зверху). Форсовано закриваємо її,
// щойно ширина перетинає той самий брейкпоінт (640px), на якому
// .mobile-cart-button і зникає.
function setupMobileCartSheetAutoClose(): void {
  const mq = window.matchMedia("(min-width: 641px)");
  mq.addEventListener("change", (e) => {
    if (!e.matches) return;
    const sheet = document.getElementById("mobile-cart-sheet");
    if (sheet?.classList.contains("mobile-cart-sheet--open")) {
      closeMobileCartSheet();
    }
  });
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

// ---- Підтвердження очищення кошика — та сама модалка (auth-modal
// класи), що й вхід/реєстрація, тільки з іншим вмістом: усвідомлено
// перевикористовуємо готовий візуальний патерн замість винаходу
// нового попапу. ----

function onClearCartModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeClearCartModal();
}

function openClearCartModal(): void {
  const modal = document.getElementById("clear-cart-modal");
  if (!modal) return;
  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onClearCartModalKeydown);
}

function closeClearCartModal(): void {
  const modal = document.getElementById("clear-cart-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onClearCartModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupClearCartModal(): void {
  // Кнопка "Очистити" є і в десктопній панелі, і в мобільній шторці —
  // обидві відкривають одну й ту саму модалку підтвердження.
  document.getElementById("cart-clear-btn")?.addEventListener("click", openClearCartModal);
  document.getElementById("mobile-cart-clear-btn")?.addEventListener("click", openClearCartModal);

  document.getElementById("clear-cart-modal-close")?.addEventListener("click", closeClearCartModal);
  document.getElementById("clear-cart-modal-backdrop")?.addEventListener("click", closeClearCartModal);
  document.getElementById("clear-cart-cancel")?.addEventListener("click", closeClearCartModal);
  document.getElementById("clear-cart-confirm")?.addEventListener("click", () => {
    clearCart();
    closeClearCartModal();
  });
}

// ---- Оформлення замовлення — той самий auth-modal візуальний
// патерн, що й "Очистити кошик?" вище, тільки з формою (адреса/
// телефон/спосіб оплати) і підсумком ціни. Замовлення можливе лише під
// акаунтом: гостю замість форми одразу показуємо вхід/реєстрацію
// (openAuthModal) — після входу треба буде натиснути "Оформити" ще раз,
// спеціально не підв'язуємось до setAuthSuccessHandler (той хендлер
// уже зайнятий у main.ts під оновлення кошика після входу, а мати два
// різні "що робити після успішного логіна" одночасно — зайве
// ускладнення заради рідкісного кейсу). ----

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  card: "Картка",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Готівка кур'єру",
};

function paymentOptionLabel(m: MyPaymentMethod): string {
  const base = PAYMENT_TYPE_LABELS[m.type] ?? m.type;
  return m.label ? `${base} — ${m.label}` : base;
}

async function populateCheckoutPaymentOptions(): Promise<void> {
  const select = document.getElementById("checkout-payment") as HTMLSelectElement | null;
  if (!select) return;

  select.innerHTML = `<option value="">Завантаження…</option>`;
  const methods = await getMyPaymentMethods();

  if (!methods.length) {
    select.innerHTML = `<option value="">Готівка кур'єру (за замовчуванням)</option>`;
    return;
  }

  select.innerHTML = methods
    .map((m) => `<option value="${m.id}"${m.isDefault ? " selected" : ""}>${paymentOptionLabel(m)}</option>`)
    .join("");
}

// Підсумок "Товари / Знижки / Доставка / До оплати" — той самий набір
// рядків, що в референсі оформлення (Товари − Знижки + Доставка = До
// оплати), локалізований під наш каталог. Рядок "Знижки" зʼявляється,
// лише коли в кошику справді є хоч якась знижка — щоб не показувати
// "−0 ₴" на порожньому місці.
function checkoutSummaryHtml(): string {
  const original = Math.round(getCartOriginalTotal());
  const discount = Math.round(getCartDiscountTotal());
  const total = Math.round(getCartTotal());

  return `
    <div class="checkout-summary__row">
      <span>Товари</span><span>${original} ${CURRENCY}</span>
    </div>
    ${
      discount > 0
        ? `<div class="checkout-summary__row checkout-summary__row--discount"><span>Знижки</span><span>−${discount} ${CURRENCY}</span></div>`
        : ""
    }
    <div class="checkout-summary__row">
      <span>Доставка</span><span>0 ${CURRENCY}</span>
    </div>
    <div class="checkout-summary__divider"></div>
    <div class="checkout-summary__row checkout-summary__row--total">
      <span>До оплати</span><span>${total} ${CURRENCY}</span>
    </div>`;
}

function renderCheckoutSummary(): void {
  const el = document.getElementById("checkout-summary");
  if (el) el.innerHTML = checkoutSummaryHtml();
}

function onCheckoutModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeCheckoutModal();
}

function resetCheckoutForm(): void {
  const form = document.getElementById("checkout-form") as HTMLFormElement | null;
  form?.reset();
  document.querySelectorAll<HTMLElement>("#checkout-form .field-error").forEach((el) => {
    el.textContent = "";
  });
  const message = document.getElementById("checkout-message");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  const submitBtn = document.getElementById("checkout-submit-btn") as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Перейти до оплати";
  }

  document.getElementById("checkout-success-view")?.setAttribute("hidden", "");
  document.getElementById("checkout-form-view")?.removeAttribute("hidden");
}

async function openCheckoutModal(): Promise<void> {
  const session = await getSession();
  if (!session) {
    openAuthModal("login");
    return;
  }
  if (!getCartItems().length) return;

  const modal = document.getElementById("checkout-modal");
  if (!modal) return;

  resetCheckoutForm();
  // Номер телефону з акаунту — одразу підставлений, але лишається
  // звичайним редагованим полем: людина отримує посилку не обов'язково
  // на свій номер (замовляє комусь), тож без права поправити тут не
  // обійтись.
  const phoneInput = document.getElementById("checkout-phone") as HTMLInputElement | null;
  if (phoneInput && session.phone) phoneInput.value = session.phone;
  renderCheckoutSummary();
  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onCheckoutModalKeydown);
  void populateCheckoutPaymentOptions();
}

function closeCheckoutModal(): void {
  const modal = document.getElementById("checkout-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onCheckoutModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

async function submitCheckout(): Promise<void> {
  const addressInput = document.getElementById("checkout-address") as HTMLInputElement | null;
  const phoneInput = document.getElementById("checkout-phone") as HTMLInputElement | null;
  const paymentSelect = document.getElementById("checkout-payment") as HTMLSelectElement | null;
  const submitBtn = document.getElementById("checkout-submit-btn") as HTMLButtonElement | null;
  const message = document.getElementById("checkout-message");
  const addressError = document.getElementById("checkout-address-error");
  const phoneError = document.getElementById("checkout-phone-error");
  if (!addressInput || !phoneInput || !submitBtn) return;

  if (addressError) addressError.textContent = "";
  if (phoneError) phoneError.textContent = "";
  if (message) message.textContent = "";

  const deliveryAddress = addressInput.value.trim();
  const contactPhone = phoneInput.value.trim();

  let hasError = false;
  if (deliveryAddress.length < 5) {
    if (addressError) addressError.textContent = "Вкажіть повну адресу доставки";
    hasError = true;
  }
  if (!/^\+?\d{9,13}$/.test(contactPhone)) {
    if (phoneError) phoneError.textContent = "Вкажіть коректний номер телефону";
    hasError = true;
  }
  if (hasError) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Оформлення…";

  const paymentMethodId = paymentSelect?.value ? Number(paymentSelect.value) : null;
  const result = await placeOrder({ deliveryAddress, contactPhone, paymentMethodId });

  submitBtn.disabled = false;
  submitBtn.textContent = "Перейти до оплати";

  if (!result.ok) {
    if (message) {
      message.textContent = result.error;
      message.classList.add("form-message--visible", "form-message--error");
    }
    return;
  }

  // Кошик на сервері вже очищено самим оформленням замовлення
  // (server.js), clearCart() тут лише синхронізує локальний кеш
  // cart.ts — повторний DELETE /api/cart, який вона робить, іде в уже
  // порожній кошик і нешкідливий.
  clearCart();
  // І перезапитуємо каталог — сервер щойно списав куплену кількість зі
  // складу, дивись коментар біля refreshProducts() у products.ts.
  void refreshProducts().then(() => syncProductControls(getCartItems()));

  const successText = document.getElementById("checkout-success-text");
  if (successText) {
    successText.textContent = `Замовлення №${result.order.id} на суму ${Math.round(
      result.order.totalAmount
    )} ${CURRENCY} прийнято. Дякуємо за покупку!`;
  }
  document.getElementById("checkout-form-view")?.setAttribute("hidden", "");
  document.getElementById("checkout-success-view")?.removeAttribute("hidden");
}

function setupCheckoutModal(): void {
  document.getElementById("cart-checkout-btn")?.addEventListener("click", () => void openCheckoutModal());
  document.getElementById("mobile-cart-checkout-btn")?.addEventListener("click", () => void openCheckoutModal());

  document.getElementById("checkout-modal-close")?.addEventListener("click", closeCheckoutModal);
  document.getElementById("checkout-modal-backdrop")?.addEventListener("click", closeCheckoutModal);
  document.getElementById("checkout-success-close")?.addEventListener("click", () => {
    closeCheckoutModal();
    closeMobileCartSheet();
  });

  document.getElementById("checkout-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitCheckout();
  });
}

export function setupCatalog(): void {
  renderCategories();
  void loadCategories();
  // Спочатку — скелетони з "переливом" (як у YouTube/Яндекс Лавці), і
  // тільки після невеликої паузи — реальні картки. Суто для відчуття
  // "щось вантажиться", а не миттєвий стрибок порожньо→повно.
  renderProductSkeletons();
  window.setTimeout(() => {
    void (async () => {
      await loadProducts();
      renderProducts();
    })();
  }, SKELETON_DELAY_MS);
  // Кошик не залежить від скелетон-паузи каталогу — тягнемо одразу,
  // окремо, паралельно з нею. Йому потрібні готові PRODUCTS (щоб
  // hydrate() у cart.ts знайшов назву/ціну за id), тож loadProducts()
  // тут іде першим — але це не зайвий запит, проміс уже кешований.
  void (async () => {
    await loadProducts();
    await loadCart();
  })();
  subscribeCart(renderCart);
  setupMobileCartSheet();
  setupMobileCartSheetAutoClose();
  setupSheetSwipeToClose();
  setupClearCartModal();
  setupCheckoutModal();
}
