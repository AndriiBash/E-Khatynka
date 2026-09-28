// ==============================
// Публічні блоки на вітрині — видно ВСІМ, і гостю, і залогіненому (на
// відміну від персональних бейджів "Ви брали раніше"/"Це беруть також
// інші" в catalog.ts, які лише для авторизованих):
//
//   • «Популярне зараз»       — бестселери (route.js: /api/products/highlights)
//   • «Акційні пропозиції»    — товари з активною знижкою
//
// Обидва рядки — це ті самі картки товару, що й в основному каталозі
// (productCardHtml), з робочими кнопками "+"/степпером: рахунок кошика
// і склад лишаються єдиним джерелом правди (PRODUCTS/CartItem), тут
// лише інший добір і порядок карток. Завдяки цьому оновлення кошика
// десь-інде (сама вітрина, кошик-панель) автоматично підхоплюється й
// тут — без додаткового коду (дивись syncProductControls у catalog.ts,
// вона синхронізує ВСІ ".product-card" на сторінці, а не лише грід).
// ==============================

import { getStorefrontHighlights } from "./storage.js";
import { PRODUCTS, loadProducts } from "./products.js";
import { productCardHtml, bindProductCardEvents, syncProductControls } from "./catalog.js";
import { getCartItems } from "./cart.js";
import type { Product } from "./products.js";

function rowHtml(title: string, iconPath: string, products: Product[], modifier: string): string {
  if (!products.length) return "";
  return `
    <section class="highlights-row highlights-row--${modifier}">
      <h2 class="highlights-row__title">
        <span class="highlights-row__icon" style="-webkit-mask-image: url('${iconPath}'); mask-image: url('${iconPath}')" aria-hidden="true"></span>
        ${title}
      </h2>
      <div class="highlights-row__scroll" data-highlights-grid="${modifier}">
        ${products.map(productCardHtml).join("")}
      </div>
    </section>`;
}

// Іконки для заголовків рядків лежать в assets/icons/ разом з рештою
// іконок проєкту.
const ICON_POPULAR = "assets/icons/highlights-popular.png";
const ICON_PROMOTED = "assets/icons/highlights-promoted.png";

// Викликається один раз при завантаженні index.html, ПІСЛЯ того, як
// PRODUCTS уже наповнено (loadProducts() у products.ts) — інакше
// нічого підбирати за id.
export async function renderStorefrontHighlights(): Promise<void> {
  const host = document.getElementById("storefront-highlights");
  if (!host) return;

  const [, { popular, promoted }] = await Promise.all([
    PRODUCTS.length === 0 ? loadProducts() : Promise.resolve(),
    getStorefrontHighlights(),
  ]);
  if (PRODUCTS.length === 0) return; // сервер не віддав жодного товару — показувати нічого

  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const pick = (ids: number[]): Product[] =>
    ids
      .map((id) => byId.get(String(id)))
      .filter((p): p is Product => p !== undefined && p.stockQuantity > 0); // подвійна страховка: сервер уже фільтрує за наявністю, але кеш PRODUCTS у браузері міг устаріти на секунди

  const popularProducts = pick(popular);
  const promotedProducts = pick(promoted);

  host.innerHTML =
    rowHtml("Популярне зараз", ICON_POPULAR, popularProducts, "popular") +
    rowHtml("Акційні пропозиції", ICON_PROMOTED, promotedProducts, "promoted");

  for (const grid of host.querySelectorAll<HTMLElement>("[data-highlights-grid]")) {
    bindProductCardEvents(grid);
  }
  syncProductControls(getCartItems());
}
