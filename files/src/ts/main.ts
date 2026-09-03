import { getSession, logout } from "./storage.js";
import { initPreloader, hidePreloader } from "./preloader.js";

// ==============================
// Головна сторінка — поки заглушка.
// Показує кнопку "Увійти" або привітання + "Вийти" залежно від сесії.
// ==============================

function setupUserMenu(): void {
  const menu = document.getElementById("user-menu");
  const trigger = document.getElementById("user-menu-trigger");
  const backdrop = document.getElementById("user-menu-backdrop");
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
      document.dispatchEvent(new CustomEvent("mobile-search:force-close"));
    }
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  backdrop?.addEventListener("click", close);

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function setupMobileSearch(): void {
  const wrap = document.getElementById("mobile-search");
  const toggle = document.getElementById("mobile-search-toggle");
  const input = document.getElementById("mobile-search-input") as HTMLInputElement | null;
  const aiBtn = document.getElementById("mobile-search-ai");
  if (!wrap || !toggle || !input) return;

  const isOpen = (): boolean => wrap.classList.contains("mobile-search--open");
  let openedAt = 0;
  let savedScrollY = 0;
  let isSettling = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let touchMoveBlocked = false;
  /** Остання зафіксована висота клавіатури (px). Після settle оновлюємо
   *  bottom тільки якщо зміна > порогу — інакше панель підказок iOS
   *  знову смикає поле на кожен символ. */
  let lockedKeyboardH = 0;

  const KEYBOARD_DELTA_THRESHOLD = 70;

  const lockBodyScroll = (): void => {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    const html = document.documentElement;
    html.style.overflow = "hidden";
    html.style.height = "100%";
    html.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.height = "100%";
    document.body.style.overscrollBehavior = "none";
  };

  const unlockBodyScroll = (): void => {
    const html = document.documentElement;
    html.style.overflow = "";
    html.style.height = "";
    html.style.overscrollBehavior = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
    document.body.style.height = "";
    document.body.style.overscrollBehavior = "";
    window.scrollTo(0, savedScrollY);
  };

  /** Повторно нав'язуємо lock — Safari іноді «виривається» після появи
   *  панелі підказок і починає мікро-скроли під каретку. */
  const reassertLock = (): void => {
    if (!isOpen()) return;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    // body fixed → scrollY має бути 0; якщо Safari все ж зрушив — повертаємо.
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (touchMoveBlocked) e.preventDefault();
  };

  const enableTouchBlock = (): void => {
    if (touchMoveBlocked) return;
    touchMoveBlocked = true;
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  };

  const disableTouchBlock = (): void => {
    if (!touchMoveBlocked) return;
    touchMoveBlocked = false;
    document.removeEventListener("touchmove", onTouchMove);
  };

  const vv = window.visualViewport;

  const measureKeyboardH = (): number => {
    if (!vv) return 0;
    return Math.max(
      0,
      Math.round(window.innerHeight - vv.height - vv.offsetTop)
    );
  };

  const applyKeyboardHeight = (force = false): void => {
    if (!isOpen()) return;
    const h = measureKeyboardH();
    if (!force && !isSettling) {
      // Після settle ігноруємо дрібні зміни (панель підказок ~30–50px).
      if (Math.abs(h - lockedKeyboardH) < KEYBOARD_DELTA_THRESHOLD) return;
    }
    lockedKeyboardH = h;
    wrap.style.bottom = `calc(${h}px + var(--space-5))`;
  };

  const syncWithKeyboard = (): void => {
    if (!isOpen()) return;
    if (isSettling) {
      applyKeyboardHeight(true);
      return;
    }
    // Після settle — тільки великі стрибки (реальне відкриття/закриття клавіатури).
    applyKeyboardHeight(false);
    reassertLock();
  };

  vv?.addEventListener("resize", syncWithKeyboard);
  vv?.addEventListener("scroll", syncWithKeyboard);

  const open = (): void => {
    wrap.classList.add("mobile-search--open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Закрити пошук");
    openedAt = Date.now();
    lockedKeyboardH = 0;
    lockBodyScroll();
    enableTouchBlock();

    input.focus({ preventScroll: true });

    applyKeyboardHeight(true);
    requestAnimationFrame(() => {
      applyKeyboardHeight(true);
      requestAnimationFrame(() => applyKeyboardHeight(true));
    });

    isSettling = true;
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      isSettling = false;
      applyKeyboardHeight(true);
      reassertLock();
    }, 800);
  };

  const close = (): void => {
    wrap.classList.remove("mobile-search--open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Пошук");
    input.value = "";
    input.blur();
    wrap.style.bottom = "";
    lockedKeyboardH = 0;
    unlockBodyScroll();
    disableTouchBlock();
    isSettling = false;
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    }
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });

  aiBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("click", (e) => {
    if (isOpen() && !wrap.contains(e.target as Node)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  document.addEventListener("mobile-search:force-close", () => {
    if (isOpen()) close();
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (isOpen() && document.activeElement !== input) close();
    }, 180);
  });

  // На кожен символ — повторно нав'язуємо lock. Саме в цей момент
  // iOS часто намагається проскролити каретку у видиму зону.
  input.addEventListener("input", () => {
    if (isOpen()) reassertLock();
  });

  // selectionchange теж може провокувати скрол (переміщення каретки).
  document.addEventListener("selectionchange", () => {
    if (isOpen() && document.activeElement === input) reassertLock();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!isOpen()) return;
      // Під час відкриття Safari сам може один раз проскролити — не закриваємо.
      if (Date.now() - openedAt < 600) {
        reassertLock();
        return;
      }
      // Якщо після lock все одно з'явився scroll — гасимо його, а не закриваємо
      // пошук (закриття дратує користувача більше, ніж дригання).
      reassertLock();
    },
    { passive: true }
  );
}

function setupDesktopSearchClear(): void {
  const input = document.getElementById("desktop-search-input") as HTMLInputElement | null;
  const clearBtn = document.getElementById("desktop-search-clear");
  if (!input || !clearBtn) return;

  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
  });
}

function render(): void {
  const slot = document.getElementById("auth-slot");
  const greeting = document.getElementById("greeting");
  if (!slot) return;

  const session = getSession();

  if (session) {
    const firstName = session.fullName.split(" ")[0];
    const initial = firstName.charAt(0).toUpperCase();

    if (greeting) {
      greeting.textContent = `Вітаємо, ${firstName}!`;
    }

    slot.innerHTML = `
      <div class="user-menu" id="user-menu">
        <button class="user-menu__trigger" id="user-menu-trigger" aria-haspopup="true" aria-expanded="false">
          <span>Привіт, ${firstName}!</span>
          <span class="user-menu__avatar" aria-hidden="true">${initial}</span>
        </button>
        <div class="user-menu__backdrop" id="user-menu-backdrop"></div>
        <div class="user-menu__dropdown">
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
          </button>
          <button class="user-menu__item" id="logout-btn" type="button">
            <img class="user-menu__icon" src="assets/icons/logout.svg" alt="" aria-hidden="true" />
            Вийти
          </button>
        </div>
      </div>`;

    document.getElementById("logout-btn")?.addEventListener("click", () => {
      logout();
      render();
    });

    setupUserMenu();
  } else {
    if (greeting) {
      greeting.textContent = "Ласкаво просимо до Є-Хатинки";
    }
    slot.innerHTML = `<a class="btn btn--primary-sm" href="login.html">Увійти</a>`;
  }
}

initPreloader();

document.addEventListener("DOMContentLoaded", () => {
  // hidePreloader() у finally — навіть якщо render() впаде з помилкою,
  // прелоадер все одно сховається, а не зависне на білому екрані назавжди.
  try {
    render();
  } finally {
    hidePreloader();
  }
  setupMobileSearch();
  setupDesktopSearchClear();
});
