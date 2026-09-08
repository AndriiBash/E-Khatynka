import { PRODUCTS, type Product } from "./products.js";
import { addToCart, setQty, getCartItems, subscribeCart, type CartItem } from "./cart.js";
import { getSession } from "./storage.js";
import { openAuthModal, setupAuthModal, setAuthSuccessHandler, closeAuthModal } from "./auth-modal.js";
import { isFavorite, toggleFavorite } from "./favorites.js";

// ==============================
// Сторінка товару ("карточка товару" в термінології е-commerce) — бере
// реальні дані з того самого products.ts, що й каталог, за id з URL
// (product.html?id=...). Кнопка "+"/степпер працює через той самий
// cart.ts, що й на головній; серце "в обране" вимагає входу — якщо
// сесії немає, показуємо запрошення увійти (той самий auth-modal, що
// й на головній, підключений і сюди).
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

function renderFavoriteIcon(button: HTMLElement, active: boolean): void {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  button.innerHTML = active
    ? `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20.5C11.6 20.5 11.2 20.36 10.9 20.1C7.5 17.2 4 13.9 4 9.9C4 7.2 6.1 5 8.7 5C10 5 11.2 5.6 12 6.6C12.8 5.6 14 5 15.3 5C17.9 5 20 7.2 20 9.9C20 13.9 16.5 17.2 13.1 20.1C12.8 20.36 12.4 20.5 12 20.5Z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20.5C11.6 20.5 11.2 20.36 10.9 20.1C7.5 17.2 4 13.9 4 9.9C4 7.2 6.1 5 8.7 5C10 5 11.2 5.6 12 6.6C12.8 5.6 14 5 15.3 5C17.9 5 20 7.2 20 9.9C20 13.9 16.5 17.2 13.1 20.1C12.8 20.36 12.4 20.5 12 20.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

// ---- Запрошення увійти, щоб додати в обране (як на референсі) ----

function openFavoriteModal(): void {
  const modal = document.getElementById("favorite-modal");
  if (!modal) return;
  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
}

function closeFavoriteModal(): void {
  const modal = document.getElementById("favorite-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
}

const SKELETON_DELAY_MS = 450;

function renderSkeleton(root: HTMLElement): void {
  root.innerHTML = `
    <div class="product-page__skeleton" aria-hidden="true">
      <div class="skeleton skeleton--image"></div>
      <div>
        <div class="product-page__skeleton-top">
          <div style="flex:1">
            <div class="skeleton product-page__skeleton-title"></div>
            <div class="skeleton product-page__skeleton-weight"></div>
          </div>
          <div class="skeleton product-page__skeleton-control"></div>
        </div>
        <div class="skeleton product-page__skeleton-price"></div>
        <div class="skeleton product-page__skeleton-desc-line"></div>
        <div class="skeleton product-page__skeleton-desc-line"></div>
        <div class="skeleton product-page__skeleton-desc-line"></div>
        <div class="product-page__skeleton-spec">
          <div class="skeleton product-page__skeleton-spec-label"></div>
          <div class="skeleton product-page__skeleton-spec-value"></div>
        </div>
        <div class="product-page__skeleton-spec">
          <div class="skeleton product-page__skeleton-spec-label"></div>
          <div class="skeleton product-page__skeleton-spec-value"></div>
        </div>
      </div>
    </div>
  `;
}

function renderProduct(root: HTMLElement, product: Product, id: string): void {
  document.title = `${product.name} – Є-Хатинка`;

  root.innerHTML = `
    <div class="product-page__layout">
      <div class="product-page__image-wrap">
        <div class="product-page__image" aria-hidden="true">${product.emoji}</div>
        <button class="product-page__favorite" id="product-page-favorite" type="button" aria-label="Додати в обране" aria-pressed="false"></button>
      </div>

      <div class="product-page__info">
        <div class="product-page__top">
          <div class="product-page__titles">
            <h1 class="product-page__name">${product.name}</h1>
            <div class="product-page__weight">${product.weight}</div>
          </div>

          <div class="product-page__control">
            <button class="product-page__plus" id="product-page-add" type="button" aria-label="Додати">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
              </svg>
            </button>
            <div class="product-page__stepper is-hidden" id="product-page-stepper">
              <button type="button" id="product-page-minus" aria-label="Менше">−</button>
              <span id="product-page-qty">1</span>
              <button type="button" id="product-page-plus" aria-label="Більше">+</button>
            </div>
          </div>
        </div>

        <div class="product-page__price">${product.price} ${CURRENCY}</div>

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

  // ---- Обране: гарантовано лише для авторизованих ----
  const favoriteBtn = document.getElementById("product-page-favorite");
  if (favoriteBtn) {
    renderFavoriteIcon(favoriteBtn, isFavorite(id));

    // Якщо людина клікнула серце, не будучи залогіненою, і потім
    // увійшла через модалку запрошення — одразу довершуємо ту саму дію,
    // а не змушуємо тицяти ще раз.
    let pendingToggleAfterLogin = false;

    favoriteBtn.addEventListener("click", () => {
      void (async () => {
        const session = await getSession();
        if (!session) {
          pendingToggleAfterLogin = true;
          openFavoriteModal();
          return;
        }
        renderFavoriteIcon(favoriteBtn, toggleFavorite(id));
      })();
    });

    document.getElementById("favorite-modal-close")?.addEventListener("click", closeFavoriteModal);
    document.getElementById("favorite-modal-backdrop")?.addEventListener("click", closeFavoriteModal);
    document.getElementById("favorite-modal-dismiss")?.addEventListener("click", () => {
      pendingToggleAfterLogin = false;
      closeFavoriteModal();
    });
    document.getElementById("favorite-modal-login")?.addEventListener("click", () => {
      closeFavoriteModal();
      openAuthModal("login");
    });

    setAuthSuccessHandler(() => {
      closeAuthModal();
      closeFavoriteModal();
      if (pendingToggleAfterLogin) {
        pendingToggleAfterLogin = false;
        renderFavoriteIcon(favoriteBtn, toggleFavorite(id));
      }
    });
    setupAuthModal();
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

  // Спочатку — переливчастий скелетон (як у YouTube/Яндекс Лавці), і
  // тільки після невеликої паузи — реальний вміст. Так само, як у
  // каталозі (catalog.ts) — товари локальні, реальної затримки мережі
  // тут немає, це суто про відчуття "щось вантажиться".
  renderSkeleton(root);
  window.setTimeout(() => renderProduct(root, product, id), SKELETON_DELAY_MS);
}

document.addEventListener("DOMContentLoaded", init);
