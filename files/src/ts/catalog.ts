import { CATEGORIES, PRODUCTS, type Product } from "./products.js";
import {
  addToCart,
  subscribeCart,
  setQty,
  getCartTotal,
  getCartCount,
  type CartItem,
} from "./cart.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";

let activeCategory = "all";

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
    });
  });
}

function productCardHtml(p: Product): string {
  return `
    <article class="product-card">
      <div class="product-card__image" aria-hidden="true">${p.emoji}</div>
      <h3 class="product-card__name">${p.name}</h3>
      <div class="product-card__price">${p.price} грн</div>
      <button class="product-card__add" type="button" data-product-id="${p.id}">До кошика</button>
    </article>`;
}

function renderProducts(): void {
  const grid = document.getElementById("products-grid");
  if (!grid) return;

  const filtered =
    activeCategory === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.category === activeCategory);

  grid.innerHTML = filtered.map(productCardHtml).join("");

  grid.querySelectorAll<HTMLButtonElement>("[data-product-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const product = PRODUCTS.find((p) => p.id === btn.dataset.productId);
      if (product) addToCart(product);
    });
  });
}

function cartItemHtml(item: CartItem): string {
  return `
    <li class="cart-item">
      <div class="cart-item__info">
        <span class="cart-item__name">${item.name}</span>
        <span class="cart-item__price">${item.price} грн</span>
      </div>
      <div class="cart-item__qty">
        <button type="button" data-qty-minus="${item.productId}" aria-label="Менше">−</button>
        <span>${item.qty}</span>
        <button type="button" data-qty-plus="${item.productId}" aria-label="Більше">+</button>
      </div>
    </li>`;
}

function bindQtyButtons(container: HTMLElement, items: CartItem[]): void {
  container.querySelectorAll<HTMLButtonElement>("[data-qty-minus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.qtyMinus;
      const item = items.find((i) => i.productId === id);
      if (id && item) setQty(id, item.qty - 1);
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

function renderCartBody(container: HTMLElement, items: CartItem[]): void {
  container.innerHTML = items.length
    ? `<ul class="cart-list">${items.map(cartItemHtml).join("")}</ul>`
    : `<p class="cart-empty">Кошик порожній.<br />Додайте щось смачне 🙂</p>`;
  bindQtyButtons(container, items);
}

function renderCart(items: CartItem[]): void {
  const count = getCartCount();
  document.querySelectorAll<HTMLElement>("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
    el.classList.toggle("is-visible", count > 0);
  });

  const totalText = `${getCartTotal()} грн`;

  const panelBody = document.getElementById("cart-panel-body");
  if (panelBody) renderCartBody(panelBody, items);
  const panelTotal = document.getElementById("cart-total");
  if (panelTotal) panelTotal.textContent = totalText;

  const mobileBody = document.getElementById("mobile-cart-body");
  if (mobileBody) renderCartBody(mobileBody, items);
  const mobileTotal = document.getElementById("mobile-cart-total");
  if (mobileTotal) mobileTotal.textContent = totalText;
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

export function setupCatalog(): void {
  renderCategories();
  renderProducts();
  subscribeCart(renderCart);
  setupMobileCartSheet();
}
