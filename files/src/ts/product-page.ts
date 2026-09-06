import { PRODUCTS } from "./products.js";
import { addToCart, setQty, getCartItems, subscribeCart, type CartItem } from "./cart.js";

// ==============================
// Сторінка товару ("карточка товару" в термінології е-commerce) — бере
// реальні дані з того самого products.ts, що й каталог, за id з URL
// (product.html?id=...). Кнопка "Додати в кошик" працює по-справжньому,
// через той самий модуль cart.ts, що й на головній.
// ==============================

const CURRENCY = "₴";

function renderControl(productId: string, items: CartItem[]): void {
  const item = items.find((i) => i.productId === productId);
  const addBtn = document.getElementById("product-page-add");
  const stepper = document.getElementById("product-page-stepper");
  const qtyDisplay = document.getElementById("product-page-qty");

  if (item) {
    addBtn?.classList.add("is-hidden");
    stepper?.classList.remove("is-hidden");
    if (qtyDisplay) qtyDisplay.textContent = String(item.qty);
  } else {
    stepper?.classList.add("is-hidden");
    addBtn?.classList.remove("is-hidden");
  }
}

function init(): void {
  const root = document.getElementById("product-page-root");
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const product = PRODUCTS.find((p) => p.id === id);

  if (!product || !id) {
    root.innerHTML = `
      <p class="product-page__missing">Такого товару не знайдено.</p>
      <a class="btn btn--primary-sm" href="index.html">На головну</a>
    `;
    return;
  }

  document.title = `${product.name} – Є-Хатинка`;

  root.innerHTML = `
    <div class="product-page__layout">
      <div class="product-page__image" aria-hidden="true">${product.emoji}</div>

      <div class="product-page__info">
        <div class="product-page__top">
          <div>
            <h1 class="product-page__name">${product.name}</h1>
            <div class="product-page__weight">${product.weight}</div>
          </div>
          <div class="product-page__control">
            <button class="btn btn--primary-sm product-page__add" id="product-page-add" type="button">
              Додати в кошик · ${product.price} ${CURRENCY}
            </button>
            <div class="product-page__stepper is-hidden" id="product-page-stepper">
              <button type="button" id="product-page-minus" aria-label="Менше">−</button>
              <span id="product-page-qty">1</span>
              <button type="button" id="product-page-plus" aria-label="Більше">+</button>
            </div>
          </div>
        </div>

        <p class="product-page__description">${product.description}</p>

        <div class="product-page__specs">
          <div class="product-page__spec">
            <div class="product-page__spec-label">Термін придатності, умови зберігання</div>
            <div class="product-page__spec-value">${product.shelfLife}</div>
          </div>
          <div class="product-page__spec">
            <div class="product-page__spec-label">Виробник</div>
            <div class="product-page__spec-value">${product.manufacturer}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("product-page-add")?.addEventListener("click", () => {
    addToCart(product);
  });
  document.getElementById("product-page-minus")?.addEventListener("click", () => {
    const item = getCartItems().find((i) => i.productId === id);
    if (item) setQty(id, item.qty - 1);
  });
  document.getElementById("product-page-plus")?.addEventListener("click", () => {
    const item = getCartItems().find((i) => i.productId === id);
    if (item) setQty(id, item.qty + 1);
  });

  subscribeCart((items) => renderControl(id, items));
}

document.addEventListener("DOMContentLoaded", init);
