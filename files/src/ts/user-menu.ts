import type { SessionUser } from "./types.js";
import { setupSwipeToClose } from "./swipe-sheet.js";
import { getTags, getMyTagPreferenceIds, setMyTagPreference } from "./storage.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";

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
        <button class="user-menu__item" id="user-menu-preferences-btn" type="button">
          <img class="user-menu__icon" src="assets/icons/preferences.svg" alt="" aria-hidden="true" />
          Мої вподобання
        </button>`;

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
    </div>${preferencesModal}`;
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

  setupMyPreferencesModal(close);
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
