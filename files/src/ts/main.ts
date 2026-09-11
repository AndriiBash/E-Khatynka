import { getSession, logout } from "./storage.js";
import { openAuthModal, setupAuthModal, setAuthSuccessHandler } from "./auth-modal.js";
import { setupCatalog, setSearchQuery } from "./catalog.js";
import { initPreloader, hidePreloader } from "./preloader.js";
import { userMenuHtml, setupUserMenu } from "./user-menu.js";

// ==============================
// "Докування" плаваючих кнопок пошуку/кошика перед футером (мобілка).
// Спільний стан між setupFloatingButtonsDock (стежить за футером) і
// setupMobileSearch (має право тимчасово заборонити докування, поки
// поле пошуку відкрите — інакше position:absolute конфліктує з
// position:fixed-логікою підйому над клавіатурою, і поле "телепортується").
// ==============================
let isFooterVisible = false;
let applyFloatingDock: () => void = () => {};

// ==============================
// Поля пошуку — два різних <input> (десктопне в шапці, мобільне знизу),
// які фізично завжди обидва в DOM (просто приховані/показані через
// медіа-запити) — тож при зміні ширини вікна раніше одне лишалось
// порожнім, а інше — з уже введеним текстом. Синхронізуємо значення
// між ними на кожен ввід.
// ==============================
function syncSearchInputs(value: string, exceptId: string): void {
  const desktop = document.getElementById("desktop-search-input") as HTMLInputElement | null;
  const mobile = document.getElementById("mobile-search-input") as HTMLInputElement | null;
  if (desktop && desktop.id !== exceptId) desktop.value = value;
  if (mobile && mobile.id !== exceptId) mobile.value = value;
}

// ==============================
// Головна сторінка — поки заглушка.
// Показує кнопку "Увійти" або привітання + "Вийти" залежно від сесії.
// ==============================


function setupMobileSearch(): void {
  const wrap = document.getElementById("mobile-search");
  const toggle = document.getElementById("mobile-search-toggle");
  const input = document.getElementById("mobile-search-input") as HTMLInputElement | null;
  const aiBtn = document.getElementById("mobile-search-ai");
  const clearTextBtn = document.getElementById("mobile-search-clear");
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
    html.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
  };

  const unlockBodyScroll = (): void => {
    const html = document.documentElement;
    html.style.overflow = "";
    html.style.overscrollBehavior = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.overflow = "";
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
    if (!touchMoveBlocked) return;
    // Не чіпаємо жести всередині самого поля пошуку — інакше на iOS
    // ламається нативне виділення тексту/перетягування каретки
    // всередині інпута (це теж робиться через touchmove). Блокуємо
    // прокрутку лише ФОНОВОЇ сторінки під плаваючою панеллю.
    const target = e.target as Node | null;
    if (target && wrap.contains(target)) return;
    e.preventDefault();
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
    // Пошук завжди відкривається згори сторінки — інакше при глибокому
    // скролі каталогу поле з'являлось би поверх довільного місця, а не
    // там, де користувач очікує його побачити. Скрол — до
    // lockBodyScroll() нижче, щоб той зафіксував саме вже нульову
    // позицію (і повернув на неї ж при закритті).
    window.scrollTo(0, 0);

    wrap.classList.add("mobile-search--open");
    // На випадок, якщо кнопку відкрили, вже будучи докованою внизу
    // біля футера — примусово знімаємо .is-docked і повертаємось до
    // fixed, щоб логіка підйому над клавіатурою нижче рахувала
    // позицію відносно вьюпорту, а не .stub.
    wrap.classList.remove("is-docked");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Закрити пошук");
    openedAt = Date.now();
    lockedKeyboardH = 0;
    lockBodyScroll();
    enableTouchBlock();
    // Через lockBodyScroll (position:fixed на body) sticky-шапка втрачає
    // свою "прилипну" позицію і "телепортується" — замість того, щоб
    // ховати шапку (як було раніше), тепер підмінюємо її на
    // position:fixed у тих самих координатах, і компенсуємо висоту, яку
    // вона звільнила з потоку, паддінгом на .stub — контент під нею не
    // підстрибує, а сама шапка лишається на місці й видимою.
    const topbar = document.querySelector<HTMLElement>(".stub__topbar");
    const stubEl = document.querySelector<HTMLElement>(".stub");
    if (topbar && stubEl) {
      stubEl.style.paddingTop = `${topbar.getBoundingClientRect().height}px`;
      topbar.classList.add("stub__topbar--pinned");
    }

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
    // Раніше тут очищався input.value — через це закриття поля виглядало
    // так, ніби воно "забуває" все, що ти щойно шукав. Тепер текст (і
    // відфільтрований каталог під ним) лишається, як і був; закриваємо
    // лише саму панель уведення.
    input.blur();
    wrap.style.bottom = "";
    lockedKeyboardH = 0;
    unlockBodyScroll();
    disableTouchBlock();
    document.querySelector(".stub__topbar")?.classList.remove("stub__topbar--pinned");
    const stubEl = document.querySelector<HTMLElement>(".stub");
    if (stubEl) stubEl.style.paddingTop = "";
    isSettling = false;
    if (settleTimer !== undefined) {
      clearTimeout(settleTimer);
      settleTimer = undefined;
    }
    // Тепер, коли поле знову position:fixed за замовчуванням, можна
    // безпечно застосувати актуальний стан докування (раптом футер
    // весь цей час був видимий).
    applyFloatingDock();
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
  // iOS часто намагається проскролити каретку у видиму зону. Заодно —
  // це саме поле пошуку тепер справді фільтрує каталог, а не просто
  // стоїть для вигляду.
  input.addEventListener("input", () => {
    if (isOpen()) reassertLock();
    syncSearchInputs(input.value, input.id);
    setSearchQuery(input.value);
  });

  // Кнопка "×" ПРЯМО В полі — очищає тільки текст (і фільтр), не
  // закриваючи саму панель пошуку. Не плутати з великою червоною
  // кнопкою "×" поруч із ШІ-кнопкою — та закриває всю панель.
  clearTextBtn?.addEventListener("click", () => {
    input.value = "";
    input.focus();
    syncSearchInputs("", input.id);
    setSearchQuery("");
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

function setupLogoHome(): void {
  // Лого відкрите як звичайне посилання на index.html (важливо для
  // 404.html — там немає JS, який би це підмінив). Тут ми на самій
  // головній сторінці, тож перехід на той самий index.html замінюємо на
  // плавний скрол угору — без зайвого перезавантаження сторінки.
  const logo = document.querySelector<HTMLAnchorElement>(".stub__topbar .brand");
  if (!logo) return;

  logo.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setupDesktopSearchClear(): void {
  const input = document.getElementById("desktop-search-input") as HTMLInputElement | null;
  const clearBtn = document.getElementById("desktop-search-clear");
  if (!input || !clearBtn) return;

  input.addEventListener("input", () => {
    syncSearchInputs(input.value, input.id);
    setSearchQuery(input.value);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
    syncSearchInputs("", input.id);
    setSearchQuery("");
  });
}

async function render(): Promise<void> {
  const slot = document.getElementById("auth-slot");
  const greeting = document.getElementById("greeting");
  if (!slot) return;

  const session = await getSession();

  // Адмін логіниться через ту саму форму (спецкейс "admin"/"pass" —
  // дивись server.js), але каталог йому не потрібен — одразу шле на
  // окрему заглушку /admin.html.
  if (session && session.role === "admin") {
    window.location.href = "admin.html";
    return;
  }

  if (session) {
    const firstName = session.fullName.split(" ")[0];

    if (greeting) {
      greeting.textContent = `Вітаємо, ${firstName}!`;
    }

    slot.innerHTML = userMenuHtml(session);

    document.getElementById("logout-btn")?.addEventListener("click", () => {
      // Чекаємо, поки /api/logout справді очистить сесію на сервері —
      // інакше render() (виклик /api/session одразу після) міг би ще
      // застати стару, ще не закриту сесію через звичайну мережеву
      // затримку.
      void (async () => {
        await logout();
        await render();
      })();
    });

    setupUserMenu();
  } else {
    if (greeting) {
      greeting.textContent = "Ласкаво просимо до Є-Хатинки";
    }
    slot.innerHTML = `<button class="btn btn--primary-sm" id="open-auth-modal" type="button">Увійти</button>`;
    document.getElementById("open-auth-modal")?.addEventListener("click", () => {
      openAuthModal("login");
    });
  }
}

function setupFloatingButtonsDock(): void {
  // Плаваючі кнопки пошуку й кошика на мобілці — position:fixed, тож
  // за замовчуванням завжди прибиті до вьюпорту, навіть коли доскролив
  // до самого футера, і наповзають на нього. IntersectionObserver каже
  // нам, коли футер потрапляє у видиму область — саме тоді перемикаємо
  // клас .is-docked (position:absolute відносно .stub, див. CSS), і
  // кнопки "зупиняються" рівно на межі з футером.
  const footer = document.querySelector(".site-footer");
  const search = document.getElementById("mobile-search");
  const cartBtn = document.getElementById("mobile-cart-button");
  if (!footer || (!search && !cartBtn)) return;

  applyFloatingDock = (): void => {
    // Поки поле пошуку відкрите (клавіатура на екрані, JS вручну керує
    // wrap.style.bottom для підйому над клавіатурою) — НЕ чіпаємо його
    // position. Перемикання fixed→absolute саме в цей момент ламало
    // всю математику підйому над клавіатурою (звідси й "телепортація"
    // поля вгору екрана при пошуку внизу довгої відфільтрованої
    // сторінки).
    if (!search?.classList.contains("mobile-search--open")) {
      search?.classList.toggle("is-docked", isFooterVisible);
    }
    cartBtn?.classList.toggle("is-docked", isFooterVisible);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      isFooterVisible = entries[0]?.isIntersecting ?? false;
      applyFloatingDock();
    },
    { threshold: 0 }
  );
  observer.observe(footer);
}

initPreloader();

document.addEventListener("DOMContentLoaded", () => {
  void (async () => {
    // hidePreloader() у finally — навіть якщо render() впаде з помилкою
    // (напр. backend не запущено), прелоадер все одно сховається, а не
    // зависне на білому екрані назавжди.
    try {
      await render();
    } finally {
      hidePreloader();
    }
  })();
  setupMobileSearch();
  setupDesktopSearchClear();
  setupLogoHome();
  setupFloatingButtonsDock();
  setAuthSuccessHandler(() => {
    void render();
  });
  setupAuthModal();
  setupCatalog();
});
