// ==============================
// Кошик тепер реально живе в БД (таблиці carts/cart_items — гостьовий
// кошик через кукі ehatynka_cart, акаунтний через user_id, мердж при
// вході робить сервер, дивись getOrCreateCart в server.js). Публічний
// API навмисно лишився повністю синхронним (addToCart/setQty/...
// повертають void і одразу оновлюють стан) — так само, як у
// favorites.ts/products.ts: локальний кеш оновлюється оптимістично й
// одразу викликає notify(), а запит на сервер летить у фоні. Якщо
// сервер відповість помилкою — не відкочуємо: для кошика це не
// критично (максимум розсинхрон на один рефреш сторінки), а зайва
// складність тут не варта того.
// ==============================

import { PRODUCTS } from "./products.js";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  originalPrice: number;
  emoji: string;
  imageUrl: string | null;
  qty: number;
  stockQuantity: number;
}

export interface CartProduct {
  id: string;
  name: string;
  price: number;
  emoji: string;
  imageUrl: string | null;
}

// Сирий стан з сервера — лише productId+quantity, без снапшоту
// назви/ціни (на відміну від попередньої localStorage-версії): назва й
// ціна тепер завжди актуальні, беруться з PRODUCTS на момент рендеру.
interface RawCartItem {
  productId: string;
  qty: number;
}

type Listener = (items: CartItem[]) => void;

let rawItems: RawCartItem[] = [];
const listeners: Listener[] = [];

function hydrate(raw: RawCartItem[]): CartItem[] {
  return raw
    .map((r) => {
      const product = PRODUCTS.find((p) => p.id === r.productId);
      if (!product) return null;
      return {
        productId: r.productId,
        name: product.name,
        price: product.price,
        originalPrice: product.originalPrice,
        emoji: product.emoji,
        imageUrl: product.imageUrl,
        qty: r.qty,
        stockQuantity: product.stockQuantity,
      };
    })
    .filter((i): i is CartItem => i !== null);
}

function notify(): void {
  const items = hydrate(rawItems);
  listeners.forEach((fn) => fn(items));
}

// Викликається одразу при підписці — тож рендер-функції не треба
// окремо запитувати початковий стан.
export function subscribeCart(fn: Listener): void {
  listeners.push(fn);
  fn(hydrate(rawItems));
}

let loadPromise: Promise<void> | null = null;

// Тягне реальний стан кошика з сервера — викликається (і чекається)
// один раз на вході сторінки, ПІСЛЯ loadProducts() (інакше hydrate()
// вище не знайде товари за id і кошик здасться порожнім). Повторні
// виклики повертають той самий проміс.
export function loadCart(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch("/api/cart", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; items?: { productId: number; quantity: number }[] };
        rawItems = (data.items ?? []).map((i) => ({ productId: String(i.productId), qty: i.quantity }));
        notify();
      } catch {
        // Мовчки лишаємо кошик порожнім — краще порожній кошик, ніж
        // зламана сторінка.
      }
    })();
  }
  return loadPromise;
}

// Застосовує "правду сервера" — те, що реально прийшло у відповідь на
// POST/PUT /api/cart/items (server.js:cartItemsResponse). Викликається
// після КОЖНОГО запиту (не лише при помилці): якщо сервер відхилив дію
// (наприклад, реальний залишок на складі вже менший, ніж думав клієнт —
// саме так і був той баг "кошик порожній" при оформленні: людина
// докидала товар понад ФАКТИЧНИЙ залишок, бо PRODUCTS у неї в браузері
// ще пам'ятав старий (більший) stockQuantity з моменту завантаження
// сторінки, add проходив локально-оптимістично, а на сервері мовчки
// відхилявся — кошик на екрані показував товар, якого насправді не
// було в cart_items, і оформлення бачило порожній кошик), локальний
// кеш тепер підтягується до реального стану, а не лишається
// розсинхронізованим до наступного перезавантаження сторінки.
function applyServerCartState(items: { productId: number; quantity: number }[] | undefined): void {
  if (!items) return;
  rawItems = items.map((i) => ({ productId: String(i.productId), qty: i.quantity }));
  notify();
}

export function addToCart(product: CartProduct): void {
  // Захист від "покласти в кошик більше, ніж є на складі" — та сама
  // умова, що керує сірою/неактивною кнопкою "+" на картці/сторінці
  // товару (catalog.ts/product-page.ts): тут вона ж, тільки як останній
  // рубіж, якщо клік усе-таки пройшов (наприклад, подія встигла
  // спрацювати до того, як кнопку встигли задизейблити). Це лише
  // клієнтський (можливо застарілий) залишок — фінальне слово все одно
  // за сервером, дивись applyServerCartState вище.
  const stock = PRODUCTS.find((p) => p.id === product.id)?.stockQuantity ?? Infinity;
  const existing = rawItems.find((i) => i.productId === product.id);
  const currentQty = existing ? existing.qty : 0;
  if (currentQty >= stock) return;

  if (existing) {
    existing.qty += 1;
  } else {
    rawItems = [...rawItems, { productId: product.id, qty: 1 }];
  }
  notify();

  void fetch("/api/cart/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ productId: Number(product.id) }),
  })
    .then((res) => res.json())
    .then((data: { ok: boolean; items?: { productId: number; quantity: number }[] }) =>
      applyServerCartState(data.items)
    )
    .catch(() => {});
}

export function removeFromCart(productId: string): void {
  rawItems = rawItems.filter((i) => i.productId !== productId);
  notify();

  void fetch(`/api/cart/items/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {});
}

export function clearCart(): void {
  rawItems = [];
  notify();

  void fetch("/api/cart", { method: "DELETE", credentials: "include" }).catch(() => {});
}

export function setQty(productId: string, qty: number): void {
  if (qty <= 0) {
    removeFromCart(productId);
    return;
  }
  // Той самий захист, що в addToCart вище — степпер у кошику теж не
  // повинен піднімати кількість вище залишку на складі.
  const stock = PRODUCTS.find((p) => p.id === productId)?.stockQuantity ?? Infinity;
  const clamped = Math.min(qty, stock);

  rawItems = rawItems.map((i) => (i.productId === productId ? { ...i, qty: clamped } : i));
  notify();

  void fetch(`/api/cart/items/${encodeURIComponent(productId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ quantity: clamped }),
  })
    .then((res) => res.json())
    .then((data: { ok: boolean; items?: { productId: number; quantity: number }[] }) =>
      applyServerCartState(data.items)
    )
    .catch(() => {});
}

export function getCartItems(): CartItem[] {
  return hydrate(rawItems);
}

export function getCartTotal(): number {
  return getCartItems().reduce((sum, i) => sum + i.price * i.qty, 0);
}

// Сума БЕЗ знижки — потрібна для рядка "Товари" в підсумку оформлення
// замовлення (checkout-модалка), де "Товари"/"Знижки" показані окремими
// рядками, а не одразу згорнуті в одну підсумкову ціну.
export function getCartOriginalTotal(): number {
  return getCartItems().reduce((sum, i) => sum + i.originalPrice * i.qty, 0);
}

export function getCartDiscountTotal(): number {
  return Math.max(0, getCartOriginalTotal() - getCartTotal());
}

export function getCartCount(): number {
  return rawItems.reduce((sum, i) => sum + i.qty, 0);
}

// Скидає кеш — на логауті: кошик, що був показаний під час сесії
// (акаунтний), більше не належить "поточному відвідувачу" (гостю), тож
// наступний loadCart() має реально перезапитати сервер, а не віддати
// закешований проміс зі старими даними.
export function resetCartCache(): void {
  rawItems = [];
  loadPromise = null;
  notify();
}
