import type { SessionUser } from "./types.js";
import { setupSwipeToClose } from "./swipe-sheet.js";
import {
  getTags,
  getMyTagPreferenceIds,
  setMyTagPreference,
  addMyPaymentMethod,
  getMyPaymentMethods,
  deleteMyPaymentMethod,
  type MyPaymentMethod,
} from "./storage.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import { getFavoriteIds, toggleFavorite, loadFavorites } from "./favorites.js";
import { PRODUCTS, loadProducts, type Product } from "./products.js";

// ==============================
// Розмітка "Привіт, X!" + випадне меню (десктоп) / нижня шторка
// (мобілка) — спільна для index.html і admin.html, щоб при правках
// (нова іконка пункту меню, зміна тексту тощо) не довелось синхронно
// редагувати два місця і неминуче забути одне з них.
// ==============================
// Довге ім'я (буває — юзер сам вписує при реєстрації) розтягувало
// кнопку "Привіт, X!" на всю ширину, а на вузьких екранах ще й
// переносило текст в 2 рядки, від чого шапка "розповзалась" (див.
// фікс висоти нижче). Обрізаємо показ до 6 символів + "…", повне ім'я
// лишається в title, щоб його можна було побачити при наведенні.
const MAX_GREETING_NAME_LENGTH = 6;

function truncateGreetingName(name: string): string {
  if (name.length <= MAX_GREETING_NAME_LENGTH + 1) return name;
  return `${name.slice(0, MAX_GREETING_NAME_LENGTH)}…`;
}

export function userMenuHtml(session: SessionUser): string {
  const firstName = session.fullName.split(" ")[0];
  const displayName = truncateGreetingName(firstName);
  const initial = firstName.charAt(0).toUpperCase();
  const isAdmin = session.role === "admin";

  // Адміну не потрібні "Мої замовлення"/"Способи оплати"/"Мої
  // вподобання" — це пункти для покупця, в адмінці в них немає сенсу.
  const customerItems = isAdmin
    ? ""
    : `
        <button class="user-menu__item" type="button">
          <img class="user-menu__icon" src="assets/icons/orders.svg" alt="" aria-hidden="true" />
          Мої замовлення
        </button>
        <button class="user-menu__item" id="user-menu-wishlist-btn" type="button">
          <img class="user-menu__icon" src="assets/icons/wishlist.svg" alt="" aria-hidden="true" />
          Список бажаного
        </button>
        <button class="user-menu__item" id="user-menu-payment-btn" type="button">
          <img class="user-menu__icon" src="assets/icons/payment.svg" alt="" aria-hidden="true" />
          Способи оплати
        </button>
        <button class="user-menu__item" id="user-menu-preferences-btn" type="button">
          <img class="user-menu__icon" src="assets/icons/preferences.svg" alt="" aria-hidden="true" />
          Мої вподобання
        </button>`;

  // Попап "Список бажаного" — та сама розмітка/стиль, що й "Способи
  // оплати" (список-і-попап), лише без форми додавання: товари туди
  // потрапляють через ♥ на сторінці товару (favorites.ts), тут — просто
  // перегляд і можливість прибрати.
  const wishlistModal = isAdmin
    ? ""
    : `
    <div class="auth-modal" id="my-wishlist-modal" aria-hidden="true">
      <div class="auth-modal__backdrop"></div>
      <div class="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="my-wishlist-modal-title">
        <button class="auth-modal__close" id="my-wishlist-modal-close" type="button" aria-label="Закрити">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <h2 id="my-wishlist-modal-title">Список бажаного</h2>
        <p class="auth-modal__subtitle">Товари, які ви відзначили сердечком на сторінці товару.</p>
        <div id="my-wishlist-list"></div>
      </div>
    </div>`;

  // Попап додавання способу оплати — та сама розмітка/класи, що й у
  // модалці входу/реєстрації (auth-modal, .field, .form-message):
  // навмисно однаковий стиль по всьому сайту, а не окремий дизайн під
  // кожну модалку. Тип оплати обирається тайлами (як вибір категорії
  // деінде в адмінці), а не випадним списком — це і є "по подобию
  // категорий" з запиту.
  const paymentModal = isAdmin
    ? ""
    : `
    <div class="auth-modal" id="my-payment-modal" aria-hidden="true">
      <div class="auth-modal__backdrop"></div>
      <div class="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="my-payment-modal-title">
        <button class="auth-modal__close" id="my-payment-modal-close" type="button" aria-label="Закрити">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <h2 id="my-payment-modal-title">Способи оплати</h2>
        <p class="auth-modal__subtitle" id="my-payment-modal-subtitle">Ваші збережені способи оплати.</p>

        <div id="my-payment-list-view">
          <div id="my-payment-methods-list" class="my-payment-methods"></div>
          <button class="btn--primary" type="button" id="my-payment-add-btn">+ Додати спосіб оплати</button>
        </div>

        <div id="my-payment-form-view" hidden>
          <button class="my-payment-back" type="button" id="my-payment-back-btn">← Назад до списку</button>
          <form id="my-payment-form" novalidate>
          <div class="field">
            <label>Спосіб оплати</label>
            <div class="payment-type-grid" id="my-payment-type-grid" role="radiogroup">
              <button class="payment-type-option" type="button" data-type="card" role="radio" aria-checked="false">
                <span class="payment-type-option__icon payment-type-option__icon--card" aria-hidden="true"></span>
                Картка
              </button>
              <button class="payment-type-option" type="button" data-type="apple_pay" role="radio" aria-checked="false">
                <span class="payment-type-option__icon payment-type-option__icon--mobile" aria-hidden="true"></span>
                Apple Pay
              </button>
              <button class="payment-type-option" type="button" data-type="google_pay" role="radio" aria-checked="false">
                <span class="payment-type-option__icon payment-type-option__icon--wallet" aria-hidden="true"></span>
                Google Pay
              </button>
              <button class="payment-type-option" type="button" data-type="cash" role="radio" aria-checked="false">
                <span class="payment-type-option__icon payment-type-option__icon--cash" aria-hidden="true"></span>
                Готівка кур'єру
              </button>
            </div>
            <span class="field-error" id="my-payment-type-error"></span>
          </div>
          <div class="field" id="my-payment-card-field" hidden>
            <label for="my-payment-card-digits">Останні 4 цифри картки</label>
            <input type="text" id="my-payment-card-digits" name="cardDigits" inputmode="numeric" maxlength="4" placeholder="1234" autocomplete="off" />
            <span class="field-error" id="my-payment-card-digits-error"></span>
          </div>
          <div class="field">
            <label for="my-payment-label">Назва (необов'язково)</label>
            <input type="text" id="my-payment-label" name="customLabel" maxlength="40" placeholder="Наприклад, «Робоча картка»" autocomplete="off" />
          </div>
          <div class="field field--checkbox">
            <input type="checkbox" id="my-payment-default" name="isDefault" />
            <label for="my-payment-default">Зробити основним способом оплати</label>
          </div>
          <button class="btn--primary" type="submit" id="my-payment-modal-submit">Додати спосіб оплати</button>
          <p class="form-message" id="my-payment-message"></p>
          </form>
        </div>
      </div>
    </div>

    <div class="auth-modal" id="my-confirm-modal" aria-hidden="true">
      <div class="auth-modal__backdrop"></div>
      <div class="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="my-confirm-modal-title">
        <h2 id="my-confirm-modal-title">Видалити?</h2>
        <p class="auth-modal__subtitle" id="my-confirm-modal-text"></p>
        <div class="my-confirm-actions">
          <button class="btn btn--ghost" id="my-confirm-modal-cancel" type="button">Скасувати</button>
          <button class="btn btn--danger" id="my-confirm-modal-confirm" type="button">Видалити</button>
        </div>
      </div>
    </div>`;

  // Модалка вподобань — лише для покупця (той самий isAdmin, що й вище):
  // адмін керує чужими вподобаннями зі своєї таблиці, а не цим вікном.
  const preferencesModal = isAdmin
    ? ""
    : `
    <div class="auth-modal" id="my-prefs-modal" aria-hidden="true">
      <div class="auth-modal__backdrop"></div>
      <div class="auth-modal__dialog auth-modal__dialog--prefs" role="dialog" aria-modal="true" aria-labelledby="my-prefs-modal-title">
        <button class="auth-modal__close" id="my-prefs-modal-close" type="button" aria-label="Закрити">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <h2 id="my-prefs-modal-title">Що вам подобається?</h2>
        <p class="auth-modal__subtitle">Оберіть теги — за ними ми підберемо каталог і рекомендації саме для вас.</p>
        <div class="pref-toggle-list" id="my-prefs-list">
          <p class="pref-toggle-list__status">Завантаження…</p>
        </div>
      </div>
    </div>`;

  return `
    <div class="user-menu" id="user-menu">
      <button class="user-menu__trigger" id="user-menu-trigger" aria-haspopup="true" aria-expanded="false" title="${session.fullName}">
        <span class="user-menu__greeting-full">Привіт, ${firstName}!</span>
        <span class="user-menu__greeting-short">Привіт, ${displayName}!</span>
        <span class="user-menu__avatar" aria-hidden="true">${initial}</span>
      </button>
      <div class="user-menu__backdrop" id="user-menu-backdrop"></div>
      <div class="user-menu__dropdown">
        <div class="user-menu__dropdown-handle-hit">
          <div class="user-menu__dropdown-handle"></div>
        </div>
        <div class="user-menu__dropdown-header">
          <h2>Меню</h2>
          <button class="user-menu__dropdown-close" id="user-menu-close" type="button" aria-label="Закрити">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>${customerItems}
        <button class="user-menu__item" id="logout-btn" type="button">
          <img class="user-menu__icon" src="assets/icons/logout.svg" alt="" aria-hidden="true" />
          Вийти
        </button>
      </div>
    </div>${preferencesModal}${paymentModal}${wishlistModal}`;
}

export function setupUserMenu(): void {
  const menu = document.getElementById("user-menu");
  const trigger = document.getElementById("user-menu-trigger");
  const backdrop = document.getElementById("user-menu-backdrop");
  const dropdown = menu?.querySelector<HTMLElement>(".user-menu__dropdown");
  const handleHit = menu?.querySelector<HTMLElement>(".user-menu__dropdown-handle-hit");
  if (!menu || !trigger) return;

  const close = (): void => {
    menu.classList.remove("user-menu--open");
    trigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("has-open-user-menu");
  };

  const toggle = (): void => {
    const isOpen = menu.classList.toggle("user-menu--open");
    trigger.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("has-open-user-menu", isOpen);
    if (isOpen) {
      // Плаваюча кнопка пошуку — сусідній елемент поза topbar, і через
      // те, що topbar має свій stacking context (position+z-index),
      // z-index самого дропдауна на неї не діє й вона "пролазить" зверху.
      // Найнадійніше — просто ховати/закривати пошук, поки меню відкрите.
      // На сторінках без мобільного пошуку (напр. admin.html) подія
      // просто нікому не слухається — нешкідливо.
      document.dispatchEvent(new CustomEvent("mobile-search:force-close"));
    }
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  backdrop?.addEventListener("click", close);
  document.getElementById("user-menu-close")?.addEventListener("click", close);

  if (dropdown && handleHit) {
    // Той самий свайп-жест, що й у кошику на мобілці.
    setupSwipeToClose(dropdown, handleHit, close);
  }

  document.addEventListener("click", (e) => {
    // composedPath() фіксує шлях кліку в момент диспатчу, на відміну
    // від e.target — той "ламається", якщо якийсь обробник на цьому ж
    // кліку встиг замінити innerHTML контейнера (детачить саму
    // клікнуту кнопку) чи зняти клас .auth-modal--open ДО того, як
    // подія по бульбашці добігла сюди. Обидва випадки реально
    // траплялись: видалення товару зі списку бажаного (renderMyWishlistList
    // перерендерює innerHTML) і підтвердження видалення способу оплати
    // (onConfirm() у my-confirm-modal знімає .auth-modal--open раніше,
    // ніж клік дістанеться document). В обох випадках подальша
    // перевірка на живий клас/.contains(e.target) хибно вирішувала,
    // що клік стався "поза меню", і знімала з <body> клас
    // has-open-user-menu — через це плаваючі кнопки пошуку/кошика
    // виринали з-під ще відкритого попапу.
    const path = e.composedPath();
    if (path.includes(menu)) return;

    // Попапи "Мої вподобання"/"Способи оплати"/"Список бажаного" (і
    // вкладена в оплату модалка підтвердження) — сиблінги #user-menu в
    // розмітці (userMenuHtml() вище: усі три йдуть ПІСЛЯ закриваючого
    // </div> самого .user-menu), а не його нащадки. Перевіряємо
    // приналежність кліку до самого елемента попапу — він завжди існує
    // в DOM, поки сторінку не перезавантажили, тож перевірка коректна
    // незалежно від того, чи встиг хтось до цього зняти клас відкриття;
    // а поки попап закритий (visibility: hidden), клік по ньому все
    // одно фізично неможливий, тож зайвого "прилипання" це не додає.
    const popupIds = ["my-prefs-modal", "my-payment-modal", "my-confirm-modal", "my-wishlist-modal"];
    for (const id of popupIds) {
      const popup = document.getElementById(id);
      if (popup && path.includes(popup)) return;
    }

    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  setupMyPreferencesModal(close);
  setupMyPaymentModal(close);
  setupMyWishlistModal(close);
}

// ==============================
// "Мої вподобання" — покупець сам вмикає/вимикає теги перемикачами
// (той самий "Яндекс-стиль" — список з тумблерами у модалці, без
// окремої кнопки "Зберегти": кожен тумблер шле зміну одразу).
// ==============================

function preferencesRowHtml(tag: { id: number; name: string; iconUrl: string | null }, checked: boolean): string {
  const icon = tag.iconUrl
    ? `<img class="pref-toggle-row__icon" src="${tag.iconUrl}" alt="" aria-hidden="true" />`
    : `<span class="pref-toggle-row__icon pref-toggle-row__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <div class="pref-toggle-row" data-tag-id="${tag.id}">
      ${icon}
      <span class="pref-toggle-row__name">${tag.name}</span>
      <label class="switch">
        <input type="checkbox" class="switch__input" ${checked ? "checked" : ""} />
        <span class="switch__track" aria-hidden="true"></span>
      </label>
    </div>`;
}

function onMyPrefsModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMyPrefsModal();
}

function closeMyPrefsModal(): void {
  const modal = document.getElementById("my-prefs-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onMyPrefsModalKeydown);
  // Той самий клас, яким ховаються плаваючі кнопки пошуку/кошика під
  // час відкритого меню користувача (body.has-open-user-menu в
  // main.css/layout.css) — тут вони так само зайві поверх модалки.
  document.body.classList.remove("has-open-user-menu");
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

async function openMyPrefsModal(): Promise<void> {
  const modal = document.getElementById("my-prefs-modal");
  const list = document.getElementById("my-prefs-list");
  const closeBtn = document.getElementById("my-prefs-modal-close");
  if (!modal || !list) return;

  list.innerHTML = `<p class="pref-toggle-list__status">Завантаження…</p>`;
  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-open-user-menu");
  lockScroll();
  document.addEventListener("keydown", onMyPrefsModalKeydown);
  // Кнопку "Мої вподобання" в шторці меню користувача натиснули, і
  // фокус лишався на ній — через це :focus-within на .user-menu
  // (потрібен для доступності десктопного дропдауна) тримав мобільну
  // шторку "відкритою" навіть після видалення класу --open, і вона
  // лишалась видно позаду цієї модалки. Переносимо фокус сюди.
  closeBtn?.focus();

  const [tags, myTagIds] = await Promise.all([getTags(), getMyTagPreferenceIds()]);

  if (!tags.length) {
    list.innerHTML = `<p class="pref-toggle-list__status">Поки що немає жодного тегу.</p>`;
    return;
  }

  const checkedIds = new Set(myTagIds);
  list.innerHTML = tags.map((tag) => preferencesRowHtml(tag, checkedIds.has(tag.id))).join("");

  list.querySelectorAll<HTMLInputElement>(".switch__input").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest<HTMLElement>("[data-tag-id]");
      const tagId = Number(row?.dataset.tagId);
      if (!Number.isInteger(tagId)) return;

      const enabled = input.checked;
      input.disabled = true;

      void (async () => {
        const result = await setMyTagPreference(tagId, enabled);
        input.disabled = false;
        if (!result.ok) {
          // Відкат перемикача — запит не пройшов (наприклад, розірвався
          // звʼязок), не лишаємо UI брехати про стан, якого нема в БД.
          input.checked = !enabled;
        }
      })();
    });
  });
}

function setupMyPreferencesModal(closeUserMenu: () => void): void {
  const modal = document.getElementById("my-prefs-modal");
  const openBtn = document.getElementById("user-menu-preferences-btn");
  const closeBtn = document.getElementById("my-prefs-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  if (!modal || !openBtn) return;

  openBtn.addEventListener("click", () => {
    // Юзер-меню (на мобілці — нижня шторка) лишалось відкритим позаду
    // цієї модалки: обидва — position:fixed на весь екран, і без
    // явного закриття шторка своїм z-index перекривала темний фон
    // модалки вподобань. Тому закриваємо його тут само, до відкриття.
    closeUserMenu();
    void openMyPrefsModal();
  });
  closeBtn?.addEventListener("click", closeMyPrefsModal);
  backdrop?.addEventListener("click", closeMyPrefsModal);
}

// ==============================
// "Способи оплати" — покупець додає СВІЙ спосіб оплати попапом з
// цього меню (адмін лише дивиться список і видаляє, див. admin.ts /
// server.js). Тип оплати обирається тайлами-радіо, а не select'ом —
// той самий принцип вибору, що й у категорій/тегів в адмінці.
// ==============================

type PaymentMethodType = "card" | "apple_pay" | "google_pay" | "cash";
let selectedPaymentType: PaymentMethodType | null = null;
// Кеш останнього списку способів оплати — потрібен синхронно у формі
// (кнопка "+ Додати"/тайл "Готівка"), щоб не робити зайвий запит до
// сервера лише заради перевірки ліміту/дубліката готівки.
let cachedPaymentMethods: MyPaymentMethod[] = [];

// Ті самі підписи й іконки, що на тайлах вибору — тут для списку вже
// доданих способів оплати, щоб кожен рядок мав свою мітку типу.
const PAYMENT_TYPE_ICON_CLASS: Record<string, string> = {
  card: "payment-type-option__icon--card",
  apple_pay: "payment-type-option__icon--mobile",
  google_pay: "payment-type-option__icon--wallet",
  cash: "payment-type-option__icon--cash",
};

function onMyPaymentModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMyPaymentModal();
}

function closeMyPaymentModal(): void {
  const modal = document.getElementById("my-payment-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onMyPaymentModalKeydown);
  document.body.classList.remove("has-open-user-menu");
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

// Невеличка "Так/Скасувати" модалка поверх попапу способів оплати —
// той самий принцип, що admin.ts::confirmDelete, лише самостійна копія
// тут (user-menu.ts не тягне admin-модуль, це окремі бандли). Скрол
// тут навмисно НЕ блокуємо/розблоковуємо — цим уже керує батьківський
// попап способів оплати, який завжди відкритий, коли викликають цю
// функцію.
function confirmMyAction(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById("my-confirm-modal");
    const titleEl = document.getElementById("my-confirm-modal-title");
    const text = document.getElementById("my-confirm-modal-text");
    const cancelBtn = document.getElementById("my-confirm-modal-cancel");
    const confirmBtn = document.getElementById("my-confirm-modal-confirm");
    const backdrop = modal?.querySelector(".auth-modal__backdrop");
    if (!modal || !cancelBtn || !confirmBtn) {
      resolve(window.confirm(message));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (text) text.textContent = message;

    const close = (result: boolean): void => {
      modal.classList.remove("auth-modal--open");
      modal.setAttribute("aria-hidden", "true");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      backdrop?.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onCancel = (): void => close(false);
    const onConfirm = (): void => close(true);

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    backdrop?.addEventListener("click", onCancel);

    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("auth-modal--open");
  });
}

async function refreshMyPaymentMethodsList(): Promise<void> {
  const list = document.getElementById("my-payment-methods-list");
  const addBtn = document.getElementById("my-payment-add-btn") as HTMLButtonElement | null;
  if (!list) return;

  const methods = await getMyPaymentMethods();
  cachedPaymentMethods = methods;

  // Ліміт — 3 способи оплати на юзера (той самий, що сервер перевіряє
  // в /api/me/payment-methods). Тут — лише проактивний UX: замість
  // того щоб дати відкрити форму й отримати помилку тільки після
  // сабміту, ховаємо кнопку додавання одразу й пояснюємо чому.
  if (addBtn) {
    addBtn.hidden = methods.length >= 3;
  }
  let limitNote = document.getElementById("my-payment-limit-note");
  if (methods.length >= 3) {
    if (!limitNote) {
      limitNote = document.createElement("p");
      limitNote.id = "my-payment-limit-note";
      limitNote.className = "my-payment-methods__empty";
      addBtn?.insertAdjacentElement("afterend", limitNote);
    }
    limitNote.textContent = "Досягнуто максимум — 3 способи оплати. Видаліть один, щоб додати інший.";
  } else {
    limitNote?.remove();
  }

  if (!methods.length) {
    list.innerHTML = `<p class="my-payment-methods__empty">У вас поки немає жодного способу оплати — додайте перший нижче.</p>`;
    return;
  }

  list.innerHTML = `
    <ul class="my-payment-methods__list">
      ${methods
        .map(
          (m) => `
        <li class="my-payment-methods__item" data-id="${m.id}">
          <span class="my-payment-methods__icon ${PAYMENT_TYPE_ICON_CLASS[m.type] ?? ""}" aria-hidden="true"></span>
          <span class="my-payment-methods__label">${escapeHtmlLocal(m.label ?? "")}</span>
          ${m.isDefault ? `<span class="my-payment-methods__badge">Основний</span>` : ""}
          <button class="my-payment-methods__remove" type="button" data-remove="${m.id}" aria-label="Видалити спосіб оплати">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </li>`
        )
        .join("")}
    </ul>`;

  list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void (async () => {
        const id = Number(btn.dataset.remove);
        const item = btn.closest<HTMLLIElement>(".my-payment-methods__item");
        const label = item?.querySelector(".my-payment-methods__label")?.textContent ?? "цей спосіб оплати";

        const confirmed = await confirmMyAction(
          "Видалити спосіб оплати?",
          `«${label}» більше не можна буде обрати при оформленні замовлення.`
        );
        if (!confirmed) return;

        const result = await deleteMyPaymentMethod(id);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        await refreshMyPaymentMethodsList();
      })();
    });
  });
}

// ==============================
// "Список бажаного" — попап-список поверх favorites.ts (localStorage,
// той самий підхід, що ♥ на сторінці товару). Тут лише читаємо й
// показуємо: додавання відбувається на сторінці товару, тут можна
// тільки прибрати товар зі списку.
// ==============================

const WISHLIST_CURRENCY = "₴";

function wishlistProducts(): Product[] {
  const ids = new Set(getFavoriteIds());
  return PRODUCTS.filter((p) => ids.has(p.id));
}

function onMyWishlistModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMyWishlistModal();
}

function closeMyWishlistModal(): void {
  const modal = document.getElementById("my-wishlist-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onMyWishlistModalKeydown);
  document.body.classList.remove("has-open-user-menu");
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function wishlistItemImageHtml(p: Product): string {
  if (p.imageUrl) {
    return `<img class="my-wishlist-item__photo" src="${p.imageUrl}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'my-wishlist-item__emoji', textContent: '${p.emoji}'}))" />`;
  }
  return `<span class="my-wishlist-item__emoji" aria-hidden="true">${p.emoji}</span>`;
}

function renderMyWishlistList(): void {
  const list = document.getElementById("my-wishlist-list");
  if (!list) return;

  const products = wishlistProducts();

  if (!products.length) {
    list.innerHTML = `<p class="my-payment-methods__empty">Поки що порожньо — натисніть ♥ на сторінці товару, щоб додати його сюди.</p>`;
    return;
  }

  list.innerHTML = `
    <ul class="my-payment-methods__list">
      ${products
        .map(
          (p) => `
        <li class="my-payment-methods__item" data-id="${p.id}">
          ${wishlistItemImageHtml(p)}
          <a class="my-payment-methods__label my-wishlist-item__name" href="product.html?id=${p.id}">${escapeHtmlLocal(
            p.name
          )}</a>
          <span class="my-wishlist-item__price">${p.price} ${WISHLIST_CURRENCY}</span>
          <button class="my-payment-methods__remove" type="button" data-remove="${p.id}" aria-label="Прибрати зі списку бажаного">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </li>`
        )
        .join("")}
    </ul>`;

  list.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.remove;
      if (!id) return;
      void (async () => {
        await toggleFavorite(id); // товар точно в списку (бо кнопка тут є) — тож toggle його прибере
        renderMyWishlistList();
      })();
    });
  });
}

async function openMyWishlistModal(): Promise<void> {
  const modal = document.getElementById("my-wishlist-modal");
  const closeBtn = document.getElementById("my-wishlist-modal-close");
  const list = document.getElementById("my-wishlist-list");
  if (!modal) return;

  if (list) list.innerHTML = `<p class="my-payment-methods__empty">Завантаження…</p>`;

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-open-user-menu");
  lockScroll();
  document.addEventListener("keydown", onMyWishlistModalKeydown);
  closeBtn?.focus();

  await Promise.all([loadProducts(), loadFavorites()]);
  renderMyWishlistList();
}

function setupMyWishlistModal(closeUserMenu: () => void): void {
  const modal = document.getElementById("my-wishlist-modal");
  const openBtn = document.getElementById("user-menu-wishlist-btn");
  const closeBtn = document.getElementById("my-wishlist-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  if (!modal || !openBtn) return;

  openBtn.addEventListener("click", () => {
    // Той самий фікс, що й у "Мої вподобання"/"Способи оплати" вище:
    // мобільна шторка меню лишається позаду попапу, якщо не закрити її
    // явно до відкриття.
    closeUserMenu();
    openMyWishlistModal();
  });
  closeBtn?.addEventListener("click", closeMyWishlistModal);
  backdrop?.addEventListener("click", closeMyWishlistModal);
}

// Локальний мінімальний екранувальник — той самий підхід, що в
// admin.ts, окрема копія тут, бо user-menu.ts не імпортує admin-модуль
// (вони збираються як окремі бандли для різних сторінок).
function escapeHtmlLocal(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Перемикання між двома "екранами" одного попапу: список уже
// доданих способів оплати (за замовчуванням) і форма додавання нового
// (лише після кліку "+ Додати спосіб оплати"). Раніше форма показувалась
// одразу разом зі списком — тепер спершу тільки список + кнопка. ----

function showMyPaymentListView(): void {
  const title = document.getElementById("my-payment-modal-title");
  const subtitle = document.getElementById("my-payment-modal-subtitle");
  const listView = document.getElementById("my-payment-list-view");
  const formView = document.getElementById("my-payment-form-view");
  if (title) title.textContent = "Способи оплати";
  if (subtitle) subtitle.textContent = "Ваші збережені способи оплати.";
  if (listView) listView.hidden = false;
  if (formView) formView.hidden = true;
  void refreshMyPaymentMethodsList();
}

function resetMyPaymentForm(): void {
  const grid = document.getElementById("my-payment-type-grid");
  const cardField = document.getElementById("my-payment-card-field");
  const cardDigits = document.getElementById("my-payment-card-digits") as HTMLInputElement | null;
  const labelInput = document.getElementById("my-payment-label") as HTMLInputElement | null;
  const defaultCheckbox = document.getElementById("my-payment-default") as HTMLInputElement | null;
  const typeError = document.getElementById("my-payment-type-error");
  const cardError = document.getElementById("my-payment-card-digits-error");
  const message = document.getElementById("my-payment-message");

  selectedPaymentType = null;
  grid?.querySelectorAll<HTMLButtonElement>(".payment-type-option").forEach((btn) => {
    btn.classList.remove("payment-type-option--active");
    btn.setAttribute("aria-checked", "false");
  });
  if (cardField) cardField.hidden = true;
  if (cardDigits) cardDigits.value = "";
  if (labelInput) labelInput.value = "";
  if (defaultCheckbox) defaultCheckbox.checked = false;
  if (typeError) typeError.textContent = "";
  if (cardError) cardError.textContent = "";
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }
}

function showMyPaymentFormView(): void {
  const title = document.getElementById("my-payment-modal-title");
  const subtitle = document.getElementById("my-payment-modal-subtitle");
  const listView = document.getElementById("my-payment-list-view");
  const formView = document.getElementById("my-payment-form-view");
  resetMyPaymentForm();
  if (title) title.textContent = "Додати спосіб оплати";
  if (subtitle) subtitle.textContent = "Оберіть, чим зручно розраховуватись за замовлення.";
  if (listView) listView.hidden = true;
  if (formView) formView.hidden = false;

  // "Готівка кур'єру" — тип без жодних власних реквізитів (на відміну
  // від картки з цифрами), тож другий такий запис був би просто
  // дублікатом першого. Дозволяємо не більше одного: якщо він вже є
  // в списку, тайл лишається видимим, але неактивним і поясненим.
  const hasCash = cachedPaymentMethods.some((m) => m.type === "cash");
  const cashOption = document.querySelector<HTMLButtonElement>('.payment-type-option[data-type="cash"]');
  if (cashOption) {
    cashOption.disabled = hasCash;
    cashOption.classList.toggle("payment-type-option--disabled", hasCash);
    cashOption.title = hasCash ? "Оплата готівкою вже додана" : "";
  }
}

function openMyPaymentModal(): void {
  const modal = document.getElementById("my-payment-modal");
  const closeBtn = document.getElementById("my-payment-modal-close");
  if (!modal) return;

  showMyPaymentListView();

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-open-user-menu");
  lockScroll();
  document.addEventListener("keydown", onMyPaymentModalKeydown);
  closeBtn?.focus();
}

function setupMyPaymentModal(closeUserMenu: () => void): void {
  const modal = document.getElementById("my-payment-modal");
  const openBtn = document.getElementById("user-menu-payment-btn");
  const closeBtn = document.getElementById("my-payment-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  const addBtn = document.getElementById("my-payment-add-btn");
  const backBtn = document.getElementById("my-payment-back-btn");
  const grid = document.getElementById("my-payment-type-grid");
  const cardField = document.getElementById("my-payment-card-field");
  const cardDigits = document.getElementById("my-payment-card-digits") as HTMLInputElement | null;
  const cardError = document.getElementById("my-payment-card-digits-error");
  const typeError = document.getElementById("my-payment-type-error");
  const labelInput = document.getElementById("my-payment-label") as HTMLInputElement | null;
  const defaultCheckbox = document.getElementById("my-payment-default") as HTMLInputElement | null;
  const form = document.getElementById("my-payment-form") as HTMLFormElement | null;
  const message = document.getElementById("my-payment-message");
  if (!modal || !openBtn || !form) return;

  openBtn.addEventListener("click", () => {
    // Той самий фікс, що й у "Мої вподобання" вище: мобільна шторка
    // меню лишається позаду попапу, якщо не закрити її явно.
    closeUserMenu();
    openMyPaymentModal();
  });
  closeBtn?.addEventListener("click", closeMyPaymentModal);
  backdrop?.addEventListener("click", closeMyPaymentModal);

  addBtn?.addEventListener("click", showMyPaymentFormView);
  backBtn?.addEventListener("click", showMyPaymentListView);

  grid?.querySelectorAll<HTMLButtonElement>(".payment-type-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPaymentType = btn.dataset.type as PaymentMethodType;
      grid.querySelectorAll<HTMLButtonElement>(".payment-type-option").forEach((b) => {
        b.classList.toggle("payment-type-option--active", b === btn);
        b.setAttribute("aria-checked", String(b === btn));
      });
      if (typeError) typeError.textContent = "";
      // Останні 4 цифри питаємо лише для картки — Apple/Google Pay й
      // готівка кур'єру не потребують жодних додаткових реквізитів.
      if (cardField) cardField.hidden = selectedPaymentType !== "card";
    });
  });

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!selectedPaymentType) {
      if (typeError) typeError.textContent = "Оберіть спосіб оплати";
      return;
    }

    let cardDigitsValue = "";
    if (selectedPaymentType === "card") {
      cardDigitsValue = cardDigits?.value.trim() ?? "";
      if (!/^\d{4}$/.test(cardDigitsValue)) {
        if (cardError) cardError.textContent = "Введіть останні 4 цифри картки";
        return;
      }
    }
    if (cardError) cardError.textContent = "";

    void (async () => {
      const result = await addMyPaymentMethod({
        type: selectedPaymentType as PaymentMethodType,
        cardDigits: selectedPaymentType === "card" ? cardDigitsValue : undefined,
        customLabel: labelInput?.value.trim() || undefined,
        isDefault: !!defaultCheckbox?.checked,
      });

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      // Повертаємось до списку — так одразу видно, що спосіб оплати
      // й справді додався, а не просто закриваємо весь попап навмання.
      showMyPaymentListView();
    })();
  });
}
