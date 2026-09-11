import type { SessionUser } from "./types.js";
import { setupSwipeToClose } from "./swipe-sheet.js";

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
        <button class="user-menu__item" type="button">
          <img class="user-menu__icon" src="assets/icons/payment.svg" alt="" aria-hidden="true" />
          Способи оплати
        </button>
        <button class="user-menu__item" type="button">
          <img class="user-menu__icon" src="assets/icons/preferences.svg" alt="" aria-hidden="true" />
          Мої вподобання
        </button>`;

  return `
    <div class="user-menu" id="user-menu">
      <button class="user-menu__trigger" id="user-menu-trigger" aria-haspopup="true" aria-expanded="false" title="${session.fullName}">
        <span>Привіт, ${displayName}!</span>
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
    </div>`;
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
    if (!menu.contains(e.target as Node)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
