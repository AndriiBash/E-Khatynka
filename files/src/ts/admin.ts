import {
  getSession,
  logout,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadCategoryIcon,
  uploadIcon,
  getTags,  createTag,
  updateTag,
  deleteTag,
  getUserTagPreferences,
  createUserTagPreference,
  updateUserTagPreference,
  deleteUserTagPreference,
  getAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  getAdminSessions,
  deleteAdminSession,
  getIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  getAdminPaymentMethods,
  deleteAdminPaymentMethod,
  getTableCounts,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getAdminWishlistItems,
  deleteAdminWishlistItem,
  getAdminCarts,
  deleteAdminCart,
  getAdminCartItems,
  deleteAdminCartItem,
  getAdminProductRecipes,
  getAdminProductTags,
  type DeleteResult,
} from "./storage.js";
import { initPreloader, hidePreloader } from "./preloader.js";
import { userMenuHtml, setupUserMenu } from "./user-menu.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import type {
  ApiCategory,
  ApiTag,
  ApiUserTagPreference,
  ApiAdminUser,
  ApiAdminSession,
  ApiIngredient,
  ApiAdminPaymentMethod,
  ApiProduct,
  ApiProductRecipeItem,
  ApiAdminWishlistItem,
  ApiAdminCart,
  ApiAdminCartItem,
  ApiAdminProductRecipeItem,
  ApiAdminProductTagItem,
} from "./types.js";

// ==============================
// Адмін-панель. Головна — плитки з назвами таблиць БД (той самий
// список, що на ER-діаграмі й у server.js/ADMIN_TABLES). З реальним
// CRUD поки "Категорії", "Теги" й "Вподобання користувачів" (звідти й
// бере дані сайдбар покупця в catalog.ts) — решта таблиць відкривається
// заглушкою "У розробці".
//
// Захист сторінки — лише на клієнті: не-адмін (чи взагалі не
// залогинений) одразу відлітає на index.html. Сам /api/admin/*
// бекенд прикритий по-справжньому (requireAdmin у server.js), а от
// HTML тут — ні, це UI-guard, не заміна серверної перевірки.
// ==============================

interface TableDef {
  key: string;
  label: string;
  // Короткий опис під заголовком картки (як на референсі).
  description: string;
  // Ім'я файлу іконки в assets/icons/ — малюється через mask-image,
  // колір бере з CSS (самому файлу колір не важливий, головне —
  // прозорий фон і суцільна заливка/лінії, той самий стиль, що й у
  // .admin-sidebar__icon--*). Поки файла немає — коло просто лишається
  // порожнім, нічого не ламається.
  icon: string;
}

// Той самий список і порядок, що в server.js (ADMIN_TABLES) — оновлено
// під нову ER-діаграму: "Типи інгредієнтів" і старі "Вподобання
// користувачів" (по ingredient_type_id) прибрані, замість них — теги
// (tags/product_tags) і вподобання по tag_id.
//
// icon: де підходила вже наявна іконка бічного меню — перевикористано
// (users/orders/catalog/warehouse). Решта — нові файли, яких поки немає
// в проєкті; імена узгоджені наперед, щоб додати можна було просто
// скинувши png в assets/icons/ під тим самим іменем (mask-image бере
// альфа-канал, колір самого файлу при рендері неважливий).
const TABLES: TableDef[] = [
  { key: "users", label: "Користувачі", description: "Інформація про зареєстрованих користувачів системи.", icon: "admin-users.png" },
  { key: "sessions", label: "Сесії", description: "Активні сесії авторизованих користувачів.", icon: "admin-table-sessions.png" },
  { key: "payment_methods", label: "Методи оплати", description: "Збережені способи оплати користувачів.", icon: "admin-table-payment-methods.png" },
  { key: "orders", label: "Замовлення", description: "Замовлення покупців та їхні статуси.", icon: "admin-orders.png" },
  { key: "order_items", label: "Продукти замовлення", description: "Товарні позиції у складі замовлень.", icon: "admin-table-order-items.png" },
  { key: "products", label: "Продукти", description: "Каталог продукції — випічка та інші товари.", icon: "admin-table-products.png" },
  { key: "categories", label: "Категорії", description: "Категорії, за якими згруповано продукти.", icon: "admin-catalog.png" },
  { key: "tags", label: "Теги", description: "Теги для позначення особливостей продуктів.", icon: "admin-table-tags.png" },
  { key: "product_tags", label: "Теги продуктів", description: "Зв'язки продуктів із тегами.", icon: "admin-table-product-tags.png" },
  { key: "carts", label: "Кошики", description: "Кошики покупців — активні та гостьові.", icon: "admin-table-carts.png" },
  { key: "cart_items", label: "Предмети кошика", description: "Товари, додані до кошиків.", icon: "admin-table-cart-items.png" },
  { key: "wishlists", label: "Списки бажаного", description: "Списки бажаного користувачів.", icon: "admin-table-wishlists.png" },
  { key: "ingredients", label: "Інгредієнти", description: "Сировина, що використовується у виробництві.", icon: "admin-table-ingredients.png" },
  { key: "product_recipes", label: "Рецепти продуктів", description: "Норми витрати інгредієнтів на продукт.", icon: "admin-table-product-recipes.png" },
  { key: "ingredient_movements", label: "Рух інгредієнтів", description: "Журнал руху інгредієнтів на складі.", icon: "admin-table-ingredient-movements.png" },
  { key: "user_tag_preferences", label: "Вподобання користувачів", description: "Вподобання користувачів за тегами продуктів.", icon: "admin-table-user-preferences.png" },
];

function formatLastUpdated(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


function pluralizeRecords(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} записів`;
  if (mod10 === 1) return `${n} запис`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} записи`;
  return `${n} записів`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ==============================
// Реконсиляція рядків таблиці замість повного innerHTML — потрібна,
// бо пошук/пагінація перерендерюють тіло таблиці на кожне натискання
// клавіші, а повна пересборка HTML пересоздавала й усі <img> іконки,
// тож вони щоразу на мить зникали й підвантажувались заново (видимий
// "мигіт", навіть коли сам список іконок не змінився). Тут — рядки з
// тим самим data-row-id переносяться (не пересоздаються), а клітинки
// патчаться на місці лише якщо контент справді інший; іконку рядка
// чіпаємо, тільки якщо її src реально змінився.
// ==============================

function reconcileTableRows(tbody: HTMLTableSectionElement, newRowsHtml: string): void {
  const temp = document.createElement("tbody");
  temp.innerHTML = newRowsHtml;
  const newRows = Array.from(temp.children) as HTMLTableRowElement[];

  const oldById = new Map<string, HTMLTableRowElement>();
  Array.from(tbody.children).forEach((tr) => {
    const id = (tr as HTMLElement).dataset.rowId;
    if (id) oldById.set(id, tr as HTMLTableRowElement);
  });

  const usedIds = new Set<string>();

  newRows.forEach((newRow, index) => {
    const id = newRow.dataset.rowId;
    const oldRow = id ? oldById.get(id) : undefined;
    const refNode = tbody.children[index] ?? null;

    if (oldRow) {
      usedIds.add(id as string);
      patchRowInPlace(oldRow, newRow);
      if (oldRow !== refNode) tbody.insertBefore(oldRow, refNode);
    } else {
      tbody.insertBefore(newRow, refNode);
    }
  });

  oldById.forEach((tr, id) => {
    if (!usedIds.has(id)) tr.remove();
  });
}

function iconCellUnchanged(oldCell: Element, newCell: Element): boolean {
  const oldImg = oldCell.querySelector("img");
  const newImg = newCell.querySelector("img");
  if (oldImg && newImg) return oldImg.getAttribute("src") === newImg.getAttribute("src");
  if (!oldImg && !newImg) return oldCell.innerHTML === newCell.innerHTML;
  return false;
}

// Невеличка анімація появи панелі перегляду — і коли переходимо від
// порожнього "Оберіть запис..." до першого заповненого перегляду, і
// коли перемикаємось між записами. Клас скидається й додається
// заново з forced reflow (void .offsetWidth), інакше повторне
// додавання того самого класу вдруге поспіль анімацію не запустить.
function animatePreviewPanelIn(panel: HTMLElement): void {
  panel.classList.remove("admin-preview--enter");
  void panel.offsetWidth;
  panel.classList.add("admin-preview--enter");
}

function patchRowInPlace(oldRow: HTMLTableRowElement, newRow: HTMLTableRowElement): void {
  if (oldRow.className !== newRow.className) oldRow.className = newRow.className;

  const oldCells = Array.from(oldRow.children);
  const newCells = Array.from(newRow.children);

  newCells.forEach((newCell, i) => {
    const oldCell = oldCells[i];
    if (!oldCell) return;

    const isIconCell = newCell.classList.contains("admin-table__icon-cell");
    if (isIconCell) {
      if (!iconCellUnchanged(oldCell, newCell)) oldCell.innerHTML = newCell.innerHTML;
      return;
    }

    if (oldCell.innerHTML !== newCell.innerHTML) oldCell.innerHTML = newCell.innerHTML;
    if (oldCell.className !== newCell.className) oldCell.className = newCell.className;
  });
}

// ==============================
// Роутинг усередині сторінки:
//   #/table/<key> — таблиця з ADMIN_TABLES (плитки на головній)
//   #/analytics, #/settings — розділи з бічного меню, яких немає
//     серед сирих таблиць БД (не прив'язані до жодної конкретної)
//   порожньо (чи будь-що інше) — головна (плитки)
// Справжніх переходів між сторінками нема, тож і "назад" у браузері
// працює природно.
// ==============================

const VIRTUAL_ROUTES: Record<string, string> = {
  "#/analytics": "Аналітика",
  "#/settings": "Налаштування",
};

// Який пункт бічного меню (data-nav) відповідає поточному hash —
// використовується і для підсвітки активного пункту, і для видимості
// футера (він лише на головній).
function currentNavKey(): string {
  const hash = window.location.hash;
  const tableMatch = hash.match(/^#\/table\/([a-z_]+)$/);
  if (tableMatch) return tableMatch[1];
  if (hash in VIRTUAL_ROUTES) return hash.slice(2); // "#/analytics" -> "analytics"
  return "home";
}

function renderRoute(): void {
  updateSidebarActiveState();
  updateFooterVisibility();

  const hash = window.location.hash;
  const tableMatch = hash.match(/^#\/table\/([a-z_]+)$/);
  if (tableMatch) {
    void renderTableView(tableMatch[1]);
    return;
  }
  if (hash in VIRTUAL_ROUTES) {
    renderStub(VIRTUAL_ROUTES[hash]);
    return;
  }
  void renderHome();
}

// ==============================
// Бічне меню (тільки десктоп, дивись main.css) — підсвітка активного
// пункту й розгортання/згортання груп "Каталог"/"Склад". Сама
// розмітка статична (admin.html), тож слухачі вішаємо один раз
// (setupSidebar() з render() нижче).
// ==============================

function updateSidebarActiveState(): void {
  const sidebar = document.getElementById("admin-sidebar");
  if (!sidebar) return;

  const activeKey = currentNavKey();

  sidebar.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    const isActive = el.dataset.nav === activeKey;
    el.classList.toggle("admin-sidebar__link--active", isActive && el.classList.contains("admin-sidebar__link"));
    el.classList.toggle("admin-sidebar__sublink--active", isActive && el.classList.contains("admin-sidebar__sublink"));
  });

  // Якщо активний пункт — підпункт групи (Продукти/Категорії в
  // "Каталозі", Інгредієнти/Рух в "Складі") — розгортаємо саме її.
  sidebar
    .querySelector(".admin-sidebar__sublink--active")
    ?.closest(".admin-sidebar__group")
    ?.classList.add("admin-sidebar__group--open");
}

function setupSidebar(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-group-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".admin-sidebar__group")?.classList.toggle("admin-sidebar__group--open");
    });
  });
}

// Футер (той самий, що на index.html) — лише на головній сторінці
// адмінки, дивись admin-footer у admin.html.
function updateFooterVisibility(): void {
  const footer = document.getElementById("admin-footer");
  if (footer) footer.hidden = currentNavKey() !== "home";
}

// ==============================
// Головна: плитки таблиць
// ==============================

// Стрілка "перейти в таблицю" праворуч знизу картки — inline SVG (не
// окремий файл), той самий підхід, що й для соцкнопок у футері нижче.
const CARD_ARROW_SVG = `
  <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4.5 10H15.5M15.5 10L11 5.5M15.5 10L11 14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

async function renderHome(): Promise<void> {
  const root = document.getElementById("admin-view");
  if (!root) return;

  root.innerHTML = `
    <h1 class="admin-page__title">Таблиці бази даних</h1>
    <div class="admin-cards">
      ${TABLES.map(
        (t) => `
        <button class="admin-card" type="button" data-table="${t.key}">
          <div class="admin-card__top">
            <span class="admin-card__icon">
              <span class="admin-card__icon-glyph" style="mask-image:url(assets/icons/${t.icon});-webkit-mask-image:url(assets/icons/${t.icon})"></span>
            </span>
            <h3 class="admin-card__title">${t.label}</h3>
          </div>
          <p class="admin-card__desc">${t.description}</p>
          <span class="admin-card__count" id="admin-tile-count-${t.key}">…</span>
          <div class="admin-card__footer">
            <span class="admin-card__updated" id="admin-tile-updated-${t.key}"></span>
            <span class="admin-card__arrow">${CARD_ARROW_SVG}</span>
          </div>
        </button>`
      ).join("")}
    </div>`;

  root.querySelectorAll<HTMLButtonElement>("[data-table]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = `#/table/${btn.dataset.table}`;
    });
  });

  const data = await getTableCounts();
  if (!data) return;
  for (const t of TABLES) {
    const countEl = document.getElementById(`admin-tile-count-${t.key}`);
    if (countEl && data.counts[t.key] !== undefined) countEl.textContent = pluralizeRecords(data.counts[t.key]);
    const updatedEl = document.getElementById(`admin-tile-updated-${t.key}`);
    if (updatedEl) updatedEl.textContent = `Останнє оновлення: ${formatLastUpdated(data.lastUpdated[t.key])}`;
  }
}

// ==============================
// Заглушка для ще не підключених розділів (і сирих таблиць БД, і
// пунктів бічного меню на кшталт "Аналітика"/"Налаштування", які
// взагалі не прив'язані до жодної окремої таблиці).
// ==============================

function renderStub(label: string): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">${label}</h1>
    <section class="admin-section">
      <div class="admin-categories-empty">Цей розділ ще в розробці.</div>
    </section>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
}

// ==============================
// Категорії — єдина таблиця з реальним CRUD. Список — проста таблиця
// (іконка/назва/опис/дії), додавання й редагування — одна й та сама
// спливаюча модалка (#admin-category-modal у admin.html), той самий
// патерн, що й підтвердження видалення нижче.
// ==============================

let allCategories: ApiCategory[] = [];
let categorySearchQuery = "";
let categoryPage = 1;
let previewCategoryId: number | null = null;
const CATEGORY_PAGE_SIZE = 8;

// Іконка модалки додавання/редагування — єдине джерело правди для
// поточного вибору файлу (сам файл уже залито на сервер одразу при
// виборі, тут лишається тільки готовий url).
let categoryModalIconUrl: string | null = null;
type CategoryModalMode = { type: "create" } | { type: "edit"; id: number };
let categoryModalMode: CategoryModalMode = { type: "create" };

function categoryIconPreviewHtml(url: string | null): string {
  return url ? `<img class="admin-icon-picker__preview" src="${url}" alt="" onerror="this.remove()" />` : "";
}

function renderCategoryModalIconPreview(): void {
  const previewSlot = document.getElementById("admin-cat-icon-preview");
  const clearBtn = document.getElementById("admin-cat-icon-clear") as HTMLButtonElement | null;
  if (previewSlot) previewSlot.innerHTML = categoryIconPreviewHtml(categoryModalIconUrl);
  if (clearBtn) clearBtn.hidden = !categoryModalIconUrl;
}

// Пікер іконки в модалці — розмітка статична (admin.html), а не
// перегенеровується щоразу, тож і слухачі вішаємо рівно один раз
// (викликається з setupCategoryModal() нижче, разом з рештою модалки).
function setupCategoryModalIconPicker(): void {
  const fileInput = document.getElementById("admin-cat-icon-file") as HTMLInputElement | null;
  const status = document.getElementById("admin-cat-icon-status");
  const clearBtn = document.getElementById("admin-cat-icon-clear");
  if (!fileInput) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (status) status.textContent = "Завантаження…";

    void (async () => {
      const result = await uploadCategoryIcon(file);
      fileInput.value = ""; // щоб той самий файл можна було обрати ще раз після помилки

      if (!result.ok) {
        if (status) status.textContent = result.error;
        return;
      }

      if (status) status.textContent = "";
      categoryModalIconUrl = result.url;
      renderCategoryModalIconPreview();
    })();
  });

  clearBtn?.addEventListener("click", () => {
    categoryModalIconUrl = null;
    if (status) status.textContent = "";
    renderCategoryModalIconPreview();
  });
}

// Іконки дій (перегляд/редагування/видалення) — винесені в окремі
// SVG-файли assets/icons/admin-*.svg замість inline-розмітки тут, за
// тим самим принципом, що й іконки бічного меню (mask-image, щоб колір
// лишався керованим через CSS currentColor/background-color кожної
// кнопки — превʼю/редагування/видалення пофарбовані по-різному).
function actionIconHtml(variant: "preview" | "edit" | "delete"): string {
  return `<span class="admin-table__action-icon admin-table__action-icon--${variant}" aria-hidden="true"></span>`;
}

function categoryRowHtml(c: ApiCategory): string {
  const icon = c.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${c.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;
  const description = c.description ? escapeHtml(c.description) : "—";

  return `
    <tr class="${c.id === previewCategoryId ? "admin-table__row--active" : ""}" data-row-id="${c.id}">
      <td class="admin-table__id-cell">${c.id}</td>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</td>
      <td class="admin-table__description-cell" title="${c.description ? escapeHtml(c.description) : ""}">${description}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${c.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${c.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${c.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

// Скелетон-рядки на час першого завантаження списку категорій (те
// саме .skeleton-переливання, що й у каталозі покупця/на сторінці
// товару — спільний механізм з tokens.css).
const CATEGORY_SKELETON_ROWS = 5;

function categorySkeletonRowHtml(): string {
  return `
    <tr>
      <td class="admin-table__id-cell"><span class="skeleton admin-table__skeleton-id"></span></td>
      <td class="admin-table__icon-cell"><span class="skeleton admin-table__skeleton-icon"></span></td>
      <td class="admin-table__name-cell"><span class="skeleton admin-table__skeleton-name"></span></td>
      <td class="admin-table__description-cell"><span class="skeleton admin-table__skeleton-description"></span></td>
      <td class="admin-table__actions-cell"></td>
    </tr>`;
}

// Спільний <colgroup> для обох рендерів таблиці (скелетон і реальні
// дані) — саме він, а не контент кожного окремого рядка, тепер визначає
// ширину колонок (table-layout: fixed нижче). Без цього auto-layout
// перераховував ширину колонок під контент КОЖНОГО рядка окремо, і
// межі сусідніх клітинок могли на піксель "гуляти" від рядка до рядка —
// це і була причина не зовсім рівних країв між рядками.
const CATEGORY_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:44px" />
    <col style="width:130px" />
    <col />
    <col style="width:150px" />
  </colgroup>`;

function renderCategoriesTableSkeleton(): void {
  const wrap = document.getElementById("admin-categories-table-wrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <table class="admin-table">
      ${CATEGORY_TABLE_COLGROUP}
      <thead>
        <tr>
          <th>ID</th>
          <th></th>
          <th>Назва</th>
          <th>Опис</th>
          <th></th>
        </tr>
      </thead>
      <tbody data-skeleton="true">
        ${Array.from({ length: CATEGORY_SKELETON_ROWS }, categorySkeletonRowHtml).join("")}
      </tbody>
    </table>`;
}

const EMPTY_CATEGORIES_HTML = `
  <div class="admin-categories-empty">
    <img class="admin-categories-empty__icon" src="assets/images/empty-categories.png" alt="" aria-hidden="true" onerror="this.style.display='none'" />
    Категорій ще немає.<br />Додайте першу кнопкою вище.
  </div>`;

// Просте регістронезалежне "містить" по назві — датасет категорій
// невеликий, повноцінний бекенд-пошук тут явно надлишковий.
function filteredCategories(): ApiCategory[] {
  const q = categorySearchQuery.trim().toLowerCase();
  if (!q) return allCategories;
  return allCategories.filter((c) => c.name.toLowerCase().includes(q));
}

function renderCategoryPagination(filteredCount: number): void {
  const el = document.getElementById("admin-categories-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / CATEGORY_PAGE_SIZE));
  const start = (categoryPage - 1) * CATEGORY_PAGE_SIZE + 1;
  const end = Math.min(categoryPage * CATEGORY_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(filteredCount)}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === categoryPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-cat-page-prev" type="button" aria-label="Попередня сторінка" ${
        categoryPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-cat-page-next" type="button" aria-label="Наступна сторінка" ${
        categoryPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-cat-page-prev")?.addEventListener("click", () => {
    if (categoryPage > 1) {
      categoryPage--;
      renderCategoriesTableBody();
    }
  });
  document.getElementById("admin-cat-page-next")?.addEventListener("click", () => {
    if (categoryPage < totalPages) {
      categoryPage++;
      renderCategoriesTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      categoryPage = Number(btn.dataset.page);
      renderCategoriesTableBody();
    });
  });
}

function renderCategoryPreviewPanel(): void {
  const panel = document.getElementById("admin-category-preview");
  if (!panel) return;

  const category = allCategories.find((c) => c.id === previewCategoryId);

  if (!category) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть категорію зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const icon = category.iconUrl
    ? `<img class="admin-preview__icon skeleton" src="${category.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;

  panel.innerHTML = `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(category.name)}</h2>
      <span class="admin-preview__id">ID: ${category.id}</span>
    </div>
    ${icon}
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Опис</span>
      <p class="admin-preview__field-value">${category.description ? escapeHtml(category.description) : "—"}</p>
    </div>
    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-preview-edit-btn")?.addEventListener("click", () => {
    openCategoryModal({ type: "edit", id: category.id });
  });

  document.getElementById("admin-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити категорію?",
        `Категорію «${category.name}» буде видалено безповоротно.`
      );
      if (!confirmed) return;
      const result = await deleteCategory(category.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewCategoryId = null;
      await loadAndRenderCategories();
    })();
  });
}

function highlightActiveTableRow(): void {
  const wrap = document.getElementById("admin-categories-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewCategoryId);
  });
}

function renderCategoriesTableBody(): void {
  const wrap = document.getElementById("admin-categories-table-wrap");
  if (!wrap) return;

  if (!allCategories.length) {
    wrap.innerHTML = EMPTY_CATEGORIES_HTML;
    renderCategoryPagination(0);
    return;
  }

  const filtered = filteredCategories();
  const totalPages = Math.max(1, Math.ceil(filtered.length / CATEGORY_PAGE_SIZE));
  if (categoryPage > totalPages) categoryPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      categorySearchQuery
    )}».</div>`;
    renderCategoryPagination(0);
    return;
  }

  const pageItems = filtered.slice((categoryPage - 1) * CATEGORY_PAGE_SIZE, categoryPage * CATEGORY_PAGE_SIZE);
  const rowsHtml = pageItems.map(categoryRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody:not([data-skeleton])");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${CATEGORY_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>ID</th>
            <th></th>
            <th>Назва</th>
            <th>Опис</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderCategoryPagination(filtered.length);
}

// Один делегований обробник кліків на весь контейнер замість
// addEventListener на кожній кнопці при кожному рендері тіла таблиці:
// оскільки рядки тепер переносяться (не пересоздаються) між
// рендерами, розвішувати нові слухачі щоразу на ті самі DOM-вузли
// означало б дублювати їх — один клік викликав би обробник кілька
// разів. Викликається один раз при відкритті сторінки "Категорії".
function setupCategoryTableEvents(): void {
  const wrap = document.getElementById("admin-categories-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewCategoryId = id;
    highlightActiveTableRow();
    renderCategoryPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      const id = Number(editBtn.dataset.edit);
      if (allCategories.some((c) => c.id === id)) openCategoryModal({ type: "edit", id });
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const category = allCategories.find((c) => c.id === id);
      if (!category) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити категорію?",
          `Категорію «${category.name}» буде видалено безповоротно.`
        );
        if (!confirmed) return;
        const result = await deleteCategory(id);
        if (!result.ok) {
          // Рідкісний край-кейс (наприклад, гонка запитів — категорію
          // вже видалили в іншій вкладці) — модалка вже закрита,
          // простого alert() тут достатньо.
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewCategoryId === id) previewCategoryId = null;
        await loadAndRenderCategories();
      })();
      return;
    }

    // Клік по всьому рядку відкриває перегляд — лише на пристроях із
    // мишею (той самий "hover: hover and pointer: fine", яким тут скрізь
    // визначають "десктоп"): на тач-екрані рядок і так вузький, і
    // випадковий тап між кнопками дій відкривав би перегляд замість
    // очікуваної дії (чи взагалі нічого).
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderCategories(): Promise<void> {
  allCategories = await getCategories();
  if (previewCategoryId !== null && !allCategories.some((c) => c.id === previewCategoryId)) {
    previewCategoryId = null;
  }
  renderCategoriesTableBody();
  renderCategoryPreviewPanel();
}

function setupCategorySearch(): void {
  const input = document.getElementById("admin-cat-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-cat-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    categorySearchQuery = input.value;
    categoryPage = 1;
    syncClearBtn();
    renderCategoriesTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    categorySearchQuery = "";
    categoryPage = 1;
    syncClearBtn();
    renderCategoriesTableBody();
    input.focus();
  });

  syncClearBtn();
}

// ---- Модалка додавання/редагування категорії ----

function onCategoryModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeCategoryModal();
}

function openCategoryModal(mode: CategoryModalMode): void {
  const modal = document.getElementById("admin-category-modal");
  const title = document.getElementById("admin-category-modal-title");
  const submitBtn = document.getElementById("admin-category-modal-submit");
  const nameInput = document.getElementById("admin-cat-name") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-cat-name-error");
  const descriptionInput = document.getElementById("admin-cat-description") as HTMLInputElement | null;
  const message = document.getElementById("admin-category-message");
  if (!modal || !nameInput) return;

  categoryModalMode = mode;

  if (nameError) nameError.textContent = "";
  nameInput.classList.remove("input--invalid");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  if (mode.type === "edit") {
    const category = allCategories.find((c) => c.id === mode.id);
    if (!category) return;
    if (title) title.textContent = "Редагувати категорію";
    if (submitBtn) submitBtn.textContent = "Зберегти";
    nameInput.value = category.name;
    if (descriptionInput) descriptionInput.value = category.description ?? "";
    categoryModalIconUrl = category.iconUrl;
  } else {
    if (title) title.textContent = "Додати категорію";
    if (submitBtn) submitBtn.textContent = "Додати категорію";
    nameInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
    categoryModalIconUrl = null;
  }

  renderCategoryModalIconPreview();

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onCategoryModalKeydown);
  nameInput.focus();
}

function closeCategoryModal(): void {
  const modal = document.getElementById("admin-category-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onCategoryModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

// Викликається один раз (з render() нижче) — сама модалка живе
// статично в admin.html і нікуди не зникає між переходами по
// таблицях, тож перевішувати слухачі щоразу не треба (і не можна,
// інакше сабміт форми задублюється).
function setupCategoryModal(): void {
  const modal = document.getElementById("admin-category-modal");
  const closeBtn = document.getElementById("admin-category-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closeCategoryModal);
  backdrop?.addEventListener("click", closeCategoryModal);

  setupCategoryModalIconPicker();

  const form = document.getElementById("admin-category-form") as HTMLFormElement | null;
  const message = document.getElementById("admin-category-message");
  const nameInput = document.getElementById("admin-cat-name") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-cat-name-error");
  const descriptionInput = document.getElementById("admin-cat-description") as HTMLInputElement | null;
  if (!form || !nameInput) return;

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (nameError) nameError.textContent = "";
    nameInput.classList.remove("input--invalid");

    if (name.length < 2) {
      if (nameError) nameError.textContent = "Введіть назву категорії (мінімум 2 символи)";
      nameInput.classList.add("input--invalid");
      return;
    }

    const input = {
      name,
      description: descriptionInput?.value.trim() ?? "",
      iconUrl: categoryModalIconUrl ?? "",
    };

    void (async () => {
      const result =
        categoryModalMode.type === "edit"
          ? await updateCategory(categoryModalMode.id, input)
          : await createCategory(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeCategoryModal();
      await loadAndRenderCategories();
    })();
  });
}

function renderCategoriesTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  categorySearchQuery = "";
  categoryPage = 1;
  previewCategoryId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Категорії</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Категорії, які ви тут додаєте, одразу зʼявляються у боковому меню каталогу для покупця.</p>
          <button class="btn btn--primary-sm admin-add-btn" id="admin-add-category-btn" type="button">+ Додати категорію</button>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-cat-search" class="admin-table-search" placeholder="Пошук категорій за назвою…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-cat-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-categories-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-categories-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-category-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-add-category-btn")?.addEventListener("click", () => {
    openCategoryModal({ type: "create" });
  });

  setupCategorySearch();
  setupCategoryTableEvents();
  renderCategoriesTableSkeleton();
  void loadAndRenderCategories();
}

// ==============================
// Теги — той самий CRUD-патерн, що й категорії, лише без опису (за
// ER-діаграмою в тегів тільки name + icon_url).
// ==============================

let allTags: ApiTag[] = [];
let tagSearchQuery = "";
let tagPage = 1;
let previewTagId: number | null = null;
const TAG_PAGE_SIZE = 8;

let tagModalIconUrl: string | null = null;
type TagModalMode = { type: "create" } | { type: "edit"; id: number };
let tagModalMode: TagModalMode = { type: "create" };

function renderTagModalIconPreview(): void {
  const previewSlot = document.getElementById("admin-tag-icon-preview");
  const clearBtn = document.getElementById("admin-tag-icon-clear") as HTMLButtonElement | null;
  if (previewSlot) previewSlot.innerHTML = categoryIconPreviewHtml(tagModalIconUrl);
  if (clearBtn) clearBtn.hidden = !tagModalIconUrl;
}

function setupTagModalIconPicker(): void {
  const fileInput = document.getElementById("admin-tag-icon-file") as HTMLInputElement | null;
  const status = document.getElementById("admin-tag-icon-status");
  const clearBtn = document.getElementById("admin-tag-icon-clear");
  if (!fileInput) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (status) status.textContent = "Завантаження…";

    void (async () => {
      const result = await uploadIcon(file, "tags");
      fileInput.value = "";

      if (!result.ok) {
        if (status) status.textContent = result.error;
        return;
      }

      if (status) status.textContent = "";
      tagModalIconUrl = result.url;
      renderTagModalIconPreview();
    })();
  });

  clearBtn?.addEventListener("click", () => {
    tagModalIconUrl = null;
    if (status) status.textContent = "";
    renderTagModalIconPreview();
  });
}

function tagRowHtml(t: ApiTag): string {
  const icon = t.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${t.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${t.id === previewTagId ? "admin-table__row--active" : ""}" data-row-id="${t.id}">
      <td class="admin-table__id-cell">${t.id}</td>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${t.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${t.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${t.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

function tagSkeletonRowHtml(): string {
  return `
    <tr>
      <td class="admin-table__id-cell"><span class="admin-table__skeleton-id skeleton"></span></td>
      <td class="admin-table__icon-cell"><span class="admin-table__skeleton-icon skeleton"></span></td>
      <td><span class="admin-table__skeleton-name skeleton"></span></td>
      <td></td>
    </tr>`;
}

// Колонок на одну менше, ніж у категорій (нема "Опис") — актуальний
// набір ширин під ту саму ідею з table-layout: fixed (див. коментар
// біля CATEGORY_TABLE_COLGROUP): однакові межі колонок у кожному рядку.
const TAG_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:44px" />
    <col />
    <col style="width:150px" />
  </colgroup>`;

function renderTagsTableSkeleton(): void {
  const wrap = document.getElementById("admin-tags-table-wrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <table class="admin-table">
      ${TAG_TABLE_COLGROUP}
      <thead>
        <tr>
          <th>ID</th>
          <th></th>
          <th>Назва</th>
          <th></th>
        </tr>
      </thead>
      <tbody data-skeleton="true">
        ${Array.from({ length: CATEGORY_SKELETON_ROWS }, tagSkeletonRowHtml).join("")}
      </tbody>
    </table>`;
}

const EMPTY_TAGS_HTML = `
  <div class="admin-categories-empty">Тегів ще немає.<br />Додайте перший кнопкою вище.</div>`;

function filteredTags(): ApiTag[] {
  const q = tagSearchQuery.trim().toLowerCase();
  if (!q) return allTags;
  return allTags.filter((t) => t.name.toLowerCase().includes(q));
}

function renderTagPagination(filteredCount: number): void {
  const el = document.getElementById("admin-tags-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / TAG_PAGE_SIZE));
  const start = (tagPage - 1) * TAG_PAGE_SIZE + 1;
  const end = Math.min(tagPage * TAG_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(filteredCount)}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === tagPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-tag-page-prev" type="button" aria-label="Попередня сторінка" ${
        tagPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-tag-page-next" type="button" aria-label="Наступна сторінка" ${
        tagPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-tag-page-prev")?.addEventListener("click", () => {
    if (tagPage > 1) {
      tagPage--;
      renderTagsTableBody();
    }
  });
  document.getElementById("admin-tag-page-next")?.addEventListener("click", () => {
    if (tagPage < totalPages) {
      tagPage++;
      renderTagsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tagPage = Number(btn.dataset.page);
      renderTagsTableBody();
    });
  });
}

function renderTagPreviewPanel(): void {
  const panel = document.getElementById("admin-tag-preview");
  if (!panel) return;

  const tag = allTags.find((t) => t.id === previewTagId);

  if (!tag) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть тег зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const icon = tag.iconUrl
    ? `<img class="admin-preview__icon skeleton" src="${tag.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;

  panel.innerHTML = `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(tag.name)}</h2>
      <span class="admin-preview__id">ID: ${tag.id}</span>
    </div>
    ${icon}
    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-tag-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-tag-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-tag-preview-edit-btn")?.addEventListener("click", () => {
    openTagModal({ type: "edit", id: tag.id });
  });

  document.getElementById("admin-tag-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete("Видалити тег?", `Тег «${tag.name}» буде видалено безповоротно.`);
      if (!confirmed) return;
      const result = await deleteTag(tag.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewTagId = null;
      await loadAndRenderTags();
    })();
  });
}

function highlightActiveTagRow(): void {
  const wrap = document.getElementById("admin-tags-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewTagId);
  });
}

function renderTagsTableBody(): void {
  const wrap = document.getElementById("admin-tags-table-wrap");
  if (!wrap) return;

  if (!allTags.length) {
    wrap.innerHTML = EMPTY_TAGS_HTML;
    renderTagPagination(0);
    return;
  }

  const filtered = filteredTags();
  const totalPages = Math.max(1, Math.ceil(filtered.length / TAG_PAGE_SIZE));
  if (tagPage > totalPages) tagPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      tagSearchQuery
    )}».</div>`;
    renderTagPagination(0);
    return;
  }

  const pageItems = filtered.slice((tagPage - 1) * TAG_PAGE_SIZE, tagPage * TAG_PAGE_SIZE);
  const rowsHtml = pageItems.map(tagRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody:not([data-skeleton])");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${TAG_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>ID</th>
            <th></th>
            <th>Назва</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderTagPagination(filtered.length);
}

function setupTagTableEvents(): void {
  const wrap = document.getElementById("admin-tags-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewTagId = id;
    highlightActiveTagRow();
    renderTagPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      const id = Number(editBtn.dataset.edit);
      if (allTags.some((t) => t.id === id)) openTagModal({ type: "edit", id });
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const tag = allTags.find((t) => t.id === id);
      if (!tag) return;

      void (async () => {
        const confirmed = await confirmDelete("Видалити тег?", `Тег «${tag.name}» буде видалено безповоротно.`);
        if (!confirmed) return;
        const result = await deleteTag(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewTagId === id) previewTagId = null;
        await loadAndRenderTags();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderTags(): Promise<void> {
  allTags = await getTags();
  if (previewTagId !== null && !allTags.some((t) => t.id === previewTagId)) {
    previewTagId = null;
  }
  renderTagsTableBody();
  renderTagPreviewPanel();
}

function setupTagSearch(): void {
  const input = document.getElementById("admin-tag-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-tag-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    tagSearchQuery = input.value;
    tagPage = 1;
    syncClearBtn();
    renderTagsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    tagSearchQuery = "";
    tagPage = 1;
    syncClearBtn();
    renderTagsTableBody();
    input.focus();
  });

  syncClearBtn();
}

// ---- Модалка додавання/редагування тегу ----

function onTagModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeTagModal();
}

function openTagModal(mode: TagModalMode): void {
  const modal = document.getElementById("admin-tag-modal");
  const title = document.getElementById("admin-tag-modal-title");
  const submitBtn = document.getElementById("admin-tag-modal-submit");
  const nameInput = document.getElementById("admin-tag-name") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-tag-name-error");
  const message = document.getElementById("admin-tag-message");
  if (!modal || !nameInput) return;

  tagModalMode = mode;

  if (nameError) nameError.textContent = "";
  nameInput.classList.remove("input--invalid");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  if (mode.type === "edit") {
    const tag = allTags.find((t) => t.id === mode.id);
    if (!tag) return;
    if (title) title.textContent = "Редагувати тег";
    if (submitBtn) submitBtn.textContent = "Зберегти";
    nameInput.value = tag.name;
    tagModalIconUrl = tag.iconUrl;
  } else {
    if (title) title.textContent = "Додати тег";
    if (submitBtn) submitBtn.textContent = "Додати тег";
    nameInput.value = "";
    tagModalIconUrl = null;
  }

  renderTagModalIconPreview();

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onTagModalKeydown);
  nameInput.focus();
}

function closeTagModal(): void {
  const modal = document.getElementById("admin-tag-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onTagModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupTagModal(): void {
  const modal = document.getElementById("admin-tag-modal");
  const closeBtn = document.getElementById("admin-tag-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closeTagModal);
  backdrop?.addEventListener("click", closeTagModal);

  setupTagModalIconPicker();

  const form = document.getElementById("admin-tag-form") as HTMLFormElement | null;
  const message = document.getElementById("admin-tag-message");
  const nameInput = document.getElementById("admin-tag-name") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-tag-name-error");
  if (!form || !nameInput) return;

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (nameError) nameError.textContent = "";
    nameInput.classList.remove("input--invalid");

    if (name.length < 2) {
      if (nameError) nameError.textContent = "Введіть назву тегу (мінімум 2 символи)";
      nameInput.classList.add("input--invalid");
      return;
    }

    const input = { name, iconUrl: tagModalIconUrl ?? "" };

    void (async () => {
      const result = tagModalMode.type === "edit" ? await updateTag(tagModalMode.id, input) : await createTag(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeTagModal();
      await loadAndRenderTags();
    })();
  });
}

function renderTagsTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  tagSearchQuery = "";
  tagPage = 1;
  previewTagId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Теги</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Теги можна прикріпити до продуктів (розділ "Теги продуктів") і показати покупцю як позначки на картці.</p>
          <button class="btn btn--primary-sm admin-add-btn" id="admin-add-tag-btn" type="button">+ Додати тег</button>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-tag-search" class="admin-table-search" placeholder="Пошук тегів за назвою…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-tag-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-tags-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-tags-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-tag-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-add-tag-btn")?.addEventListener("click", () => {
    openTagModal({ type: "create" });
  });

  setupTagSearch();
  setupTagTableEvents();
  renderTagsTableSkeleton();
  void loadAndRenderTags();
}

// ==============================
// Вподобання користувачів (user_tag_preferences) — простіший список:
// без окремої панелі перегляду (уся інформація вже в самому рядку),
// додавання — вибором користувача й тегу з випадних списків.
// ==============================

let allPreferences: ApiUserTagPreference[] = [];
let prefSearchQuery = "";
let prefPage = 1;
let previewPrefId: number | null = null;
const PREF_PAGE_SIZE = 8;

type PrefModalMode = { type: "create" } | { type: "edit"; id: number };
let prefModalMode: PrefModalMode = { type: "create" };

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
}

// Компактний варіант для клітинок таблиці: "11.09.2026, 12:23" замість
// "11 вер. 2026 р., 12:23" — той самий зміст, але вдвічі вужче, тож
// колонка з датою більше не обрізається трьома крапками. У картці
// перегляду праворуч місця вистачає, там лишається повний формат.
function formatDateTimeShort(ms: number): string {
  return new Date(ms).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" });
}

function filteredPreferences(): ApiUserTagPreference[] {
  const q = prefSearchQuery.trim().toLowerCase();
  if (!q) return allPreferences;
  return allPreferences.filter(
    (p) => p.userFullName.toLowerCase().includes(q) || p.tagName.toLowerCase().includes(q)
  );
}

function prefRowHtml(p: ApiUserTagPreference): string {
  const icon = p.tagIconUrl
    ? `<img class="admin-table__icon skeleton" src="${p.tagIconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${p.id === previewPrefId ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
      <td class="admin-table__id-cell">${p.id}</td>
      <td class="admin-table__user-cell" title="${escapeHtml(p.userFullName)}">
        <span class="admin-table__user-name">${escapeHtml(p.userFullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(p.userEmail)}</span>
      </td>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell" title="${escapeHtml(p.tagName)}">${escapeHtml(p.tagName)}</td>
      <td class="admin-table__description-cell">${formatDateTimeShort(p.createdAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${p.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${p.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${p.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

// Останню колонку розширено під 3 кнопки (перегляд/редагування/
// видалення) замість однієї "видалити" — так само, як у категорій/тегів.
const PREF_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:170px" />
    <col style="width:44px" />
    <col style="width:110px" />
    <col />
    <col style="width:150px" />
  </colgroup>`;

const EMPTY_PREFS_HTML = `
  <div class="admin-categories-empty">Вподобань ще немає.<br />Додайте перше кнопкою вище.</div>`;


function renderPrefPagination(filteredCount: number): void {
  const el = document.getElementById("admin-prefs-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / PREF_PAGE_SIZE));
  const start = (prefPage - 1) * PREF_PAGE_SIZE + 1;
  const end = Math.min(prefPage * PREF_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(filteredCount)}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === prefPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-pref-page-prev" type="button" aria-label="Попередня сторінка" ${
        prefPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-pref-page-next" type="button" aria-label="Наступна сторінка" ${
        prefPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-pref-page-prev")?.addEventListener("click", () => {
    if (prefPage > 1) {
      prefPage--;
      renderPrefsTableBody();
    }
  });
  document.getElementById("admin-pref-page-next")?.addEventListener("click", () => {
    if (prefPage < totalPages) {
      prefPage++;
      renderPrefsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      prefPage = Number(btn.dataset.page);
      renderPrefsTableBody();
    });
  });
}

function renderPrefPreviewPanel(): void {
  const panel = document.getElementById("admin-pref-preview");
  if (!panel) return;

  const pref = allPreferences.find((p) => p.id === previewPrefId);

  if (!pref) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть запис зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const icon = pref.tagIconUrl
    ? `<img class="admin-preview__icon skeleton" src="${pref.tagIconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;

  panel.innerHTML = `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(pref.tagName)}</h2>
      <span class="admin-preview__id">ID: ${pref.id}</span>
    </div>
    ${icon}
    ${previewFieldHtml("user", "Користувач", escapeHtml(pref.userFullName))}
    ${previewFieldHtml("email", "Email", escapeHtml(pref.userEmail))}
    ${previewFieldHtml("tag", "Тег", escapeHtml(pref.tagName))}
    ${previewFieldHtml("calendar", "Додано", formatDateTime(pref.createdAt))}
    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-pref-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-pref-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-pref-preview-edit-btn")?.addEventListener("click", () => {
    void openPrefModal({ type: "edit", id: pref.id });
  });

  document.getElementById("admin-pref-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити вподобання?",
        `Вподобання «${pref.userFullName} → ${pref.tagName}» буде видалено безповоротно.`
      );
      if (!confirmed) return;
      const result = await deleteUserTagPreference(pref.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewPrefId = null;
      await loadAndRenderPrefs();
    })();
  });
}

function highlightActivePrefRow(): void {
  const wrap = document.getElementById("admin-prefs-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewPrefId);
  });
}

function renderPrefsTableBody(): void {
  const wrap = document.getElementById("admin-prefs-table-wrap");
  if (!wrap) return;

  if (!allPreferences.length) {
    wrap.innerHTML = EMPTY_PREFS_HTML;
    renderPrefPagination(0);
    return;
  }

  const filtered = filteredPreferences();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PREF_PAGE_SIZE));
  if (prefPage > totalPages) prefPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      prefSearchQuery
    )}».</div>`;
    renderPrefPagination(0);
    return;
  }

  const pageItems = filtered.slice((prefPage - 1) * PREF_PAGE_SIZE, prefPage * PREF_PAGE_SIZE);
  const rowsHtml = pageItems.map(prefRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${PREF_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>ID</th>
            <th>Користувач</th>
            <th></th>
            <th>Тег</th>
            <th>Додано</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderPrefPagination(filtered.length);
}

function setupPrefTableEvents(): void {
  const wrap = document.getElementById("admin-prefs-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewPrefId = id;
    highlightActivePrefRow();
    renderPrefPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      const id = Number(editBtn.dataset.edit);
      if (allPreferences.some((p) => p.id === id)) void openPrefModal({ type: "edit", id });
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const pref = allPreferences.find((p) => p.id === id);
      if (!pref) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити вподобання?",
          `Вподобання «${pref.userFullName} → ${pref.tagName}» буде видалено безповоротно.`
        );
        if (!confirmed) return;
        const result = await deleteUserTagPreference(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewPrefId === id) previewPrefId = null;
        await loadAndRenderPrefs();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderPrefs(): Promise<void> {
  allPreferences = await getUserTagPreferences();
  if (previewPrefId !== null && !allPreferences.some((p) => p.id === previewPrefId)) {
    previewPrefId = null;
  }
  renderPrefsTableBody();
  renderPrefPreviewPanel();
}

function setupPrefSearch(): void {
  const input = document.getElementById("admin-pref-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-pref-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    prefSearchQuery = input.value;
    prefPage = 1;
    syncClearBtn();
    renderPrefsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    prefSearchQuery = "";
    prefPage = 1;
    syncClearBtn();
    renderPrefsTableBody();
    input.focus();
  });

  syncClearBtn();
}

// ---- Модалка додавання вподобання (вибір користувача + тегу) ----

function onPrefModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closePrefModal();
}

async function openPrefModal(mode: PrefModalMode): Promise<void> {
  const modal = document.getElementById("admin-pref-modal");
  const title = document.getElementById("admin-pref-modal-title");
  const submitBtn = document.getElementById("admin-pref-modal-submit");
  const userSelect = document.getElementById("admin-pref-user") as HTMLSelectElement | null;
  const tagSelect = document.getElementById("admin-pref-tag") as HTMLSelectElement | null;
  const message = document.getElementById("admin-pref-message");
  const userError = document.getElementById("admin-pref-user-error");
  const tagError = document.getElementById("admin-pref-tag-error");
  if (!modal || !userSelect || !tagSelect) return;

  prefModalMode = mode;

  if (userError) userError.textContent = "";
  if (tagError) tagError.textContent = "";
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  const editingPref = mode.type === "edit" ? allPreferences.find((p) => p.id === mode.id) : null;
  if (title) title.textContent = mode.type === "edit" ? "Редагувати вподобання" : "Додати вподобання";
  if (submitBtn) submitBtn.textContent = mode.type === "edit" ? "Зберегти" : "Додати вподобання";

  userSelect.innerHTML = `<option value="">Завантаження…</option>`;
  tagSelect.innerHTML = `<option value="">Завантаження…</option>`;

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onPrefModalKeydown);

  const [users, tags] = await Promise.all([getAdminUsers(), allTags.length ? Promise.resolve(allTags) : getTags()]);

  userSelect.innerHTML = users
    .map((u: ApiAdminUser) => `<option value="${u.id}">${escapeHtml(u.fullName)} (${escapeHtml(u.email)})</option>`)
    .join("");
  tagSelect.innerHTML = tags.map((t: ApiTag) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");

  if (!users.length) userSelect.innerHTML = `<option value="">Немає користувачів</option>`;
  if (!tags.length) tagSelect.innerHTML = `<option value="">Спочатку додайте тег</option>`;

  if (editingPref) {
    userSelect.value = editingPref.userId;
    tagSelect.value = String(editingPref.tagId);
  }
}

function closePrefModal(): void {
  const modal = document.getElementById("admin-pref-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onPrefModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupPrefModal(): void {
  const modal = document.getElementById("admin-pref-modal");
  const closeBtn = document.getElementById("admin-pref-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closePrefModal);
  backdrop?.addEventListener("click", closePrefModal);

  const form = document.getElementById("admin-pref-form") as HTMLFormElement | null;
  const message = document.getElementById("admin-pref-message");
  const userSelect = document.getElementById("admin-pref-user") as HTMLSelectElement | null;
  const tagSelect = document.getElementById("admin-pref-tag") as HTMLSelectElement | null;
  if (!form || !userSelect || !tagSelect) return;

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const userId = userSelect.value;
    const tagId = Number(tagSelect.value);
    if (!userId || !Number.isInteger(tagId)) return;

    void (async () => {
      const result =
        prefModalMode.type === "edit"
          ? await updateUserTagPreference(prefModalMode.id, { userId, tagId })
          : await createUserTagPreference({ userId, tagId });

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      closePrefModal();
      await loadAndRenderPrefs();
    })();
  });
}

function renderUserPreferencesTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  prefSearchQuery = "";
  prefPage = 1;
  previewPrefId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Вподобання користувачів</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Тут — теги, продукти з якими користувач ХОЧЕ бачити в каталозі й рекомендаціях.</p>
          <button class="btn btn--primary-sm admin-add-btn" id="admin-add-pref-btn" type="button">+ Додати вподобання</button>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-pref-search" class="admin-table-search" placeholder="Пошук за користувачем або тегом…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-pref-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-prefs-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-prefs-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-pref-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-add-pref-btn")?.addEventListener("click", () => {
    void openPrefModal({ type: "create" });
  });

  setupPrefSearch();
  setupPrefTableEvents();
  renderPrefsTableSkeleton();
  void loadAndRenderPrefs();
}

function renderPrefsTableSkeleton(): void {
  const wrap = document.getElementById("admin-prefs-table-wrap");
  if (wrap) wrap.innerHTML = "";
}

// ==============================
// "Користувачі" — лише перегляд + видалення (без модалки додавання:
// користувачі реєструються самі через форму на сайті, адмінка тут не
// створює акаунти вручну, як категорії/теги).
// ==============================

let allUsers: ApiAdminUser[] = [];
let userSearchQuery = "";
let userPage = 1;
let previewUserId: string | null = null;
const USER_PAGE_SIZE = 8;

function filteredUsers(): ApiAdminUser[] {
  const q = userSearchQuery.trim().toLowerCase();
  if (!q) return allUsers;
  return allUsers.filter(
    (u) =>
      u.fullName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone.toLowerCase().includes(q)
  );
}

function userRoleBadgeHtml(role: string): string {
  const isAdmin = role === "admin";
  return `<span class="admin-table__badge${isAdmin ? " admin-table__badge--accent" : ""}">${
    isAdmin ? "Адміністратор" : "Покупець"
  }</span>`;
}

function userRowHtml(u: ApiAdminUser): string {
  return `
    <tr class="${u.id === previewUserId ? "admin-table__row--active" : ""}" data-row-id="${escapeHtml(u.id)}">
      <td class="admin-table__user-cell" title="${escapeHtml(u.fullName)}">
        <span class="admin-table__user-name">${escapeHtml(u.fullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(u.email)}</span>
      </td>
      <td class="admin-table__description-cell">${escapeHtml(u.phone)}</td>
      <td class="admin-table__description-cell admin-table__badge-cell">${userRoleBadgeHtml(u.role)}</td>
      <td class="admin-table__description-cell">${formatDateTimeShort(u.createdAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${escapeHtml(u.id)}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${escapeHtml(u.id)}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${escapeHtml(u.id)}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

// Ширини підрізані під реальний вміст (телефон/роль/дата — фіксовані,
// імʼя+email тягнеться рештою). Було ширше — і разом із панеллю
// перегляду праворуч таблиця не влазила в картку: зʼявлявся
// горизонтальний скрол, а браузер при кліку на кнопку «око» ще й
// підкручував його до цієї кнопки — тому перша колонка
// («Користувач») просто зникала з очей, а «кошик» лишався
// підрізаним. Тепер сума колонок менша за картку, і скролити нічого
// не треба. Остання колонка — 3 кнопки по 36px + відступи.
const USER_TABLE_COLGROUP = `
  <colgroup>
    <col />
    <col style="width:125px" />
    <col style="width:150px" />
    <col style="width:110px" />
    <col style="width:150px" />
  </colgroup>`;

const EMPTY_USERS_HTML = `<div class="admin-categories-empty">Користувачів ще немає.</div>`;

function renderUserPagination(filteredCount: number): void {
  const el = document.getElementById("admin-users-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / USER_PAGE_SIZE));
  const start = (userPage - 1) * USER_PAGE_SIZE + 1;
  const end = Math.min(userPage * USER_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(filteredCount)}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === userPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-user-page-prev" type="button" aria-label="Попередня сторінка" ${
        userPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-user-page-next" type="button" aria-label="Наступна сторінка" ${
        userPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-user-page-prev")?.addEventListener("click", () => {
    if (userPage > 1) {
      userPage--;
      renderUsersTableBody();
    }
  });
  document.getElementById("admin-user-page-next")?.addEventListener("click", () => {
    if (userPage < totalPages) {
      userPage++;
      renderUsersTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      userPage = Number(btn.dataset.page);
      renderUsersTableBody();
    });
  });
}

function formatCurrency(amount: number): string {
  return `${Math.round(amount).toLocaleString("uk-UA")} ₴`;
}

// Іконки рядків у картках перегляду (користувач/сесія/вподобання) —
// окремі файли в assets/icons/admin-preview-*.png, як і решта іконок
// адмінки. Малюються через mask-image, а не <img>: колір бере CSS
// (--color-text-muted), тож самі файли — просто чорний силует на
// прозорому фоні. Одну й ту саму іконку спокійно ділять кілька
// таблиць (дата реєстрації / дата додавання — той самий календар).
const PREVIEW_ICONS = {
  email: "admin-preview-email.png",
  phone: "admin-preview-phone.png",
  calendar: "admin-preview-calendar.png",
  orders: "admin-preview-orders.png",
  wallet: "admin-preview-wallet.png",
  user: "admin-preview-user.png",
  tag: "admin-preview-tag.png",
  clock: "admin-preview-clock.png",
  key: "admin-preview-key.png",
  shield: "admin-preview-shield.png",
  hash: "admin-preview-hash.png",
} as const;

type PreviewIconName = keyof typeof PREVIEW_ICONS;

function previewFieldHtml(icon: PreviewIconName, label: string, value: string): string {
  const file = PREVIEW_ICONS[icon];
  return `
    <div class="admin-preview__field admin-preview__field--icon">
      <span class="admin-preview__field-icon">
        <span class="admin-preview__field-icon-glyph" style="mask-image:url(assets/icons/${file});-webkit-mask-image:url(assets/icons/${file})"></span>
      </span>
      <div class="admin-preview__field-text">
        <span class="admin-preview__field-label">${label}</span>
        <p class="admin-preview__field-value">${value}</p>
      </div>
    </div>`;
}

function renderUserPreviewPanel(): void {
  const panel = document.getElementById("admin-user-preview");
  if (!panel) return;

  const user = allUsers.find((u) => u.id === previewUserId);
  if (!user) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть користувача зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const initial = user.fullName.trim().charAt(0).toUpperCase() || "?";

  panel.innerHTML = `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
      <div>
        <h2 class="admin-preview__name">${escapeHtml(user.fullName)}</h2>
        ${userRoleBadgeHtml(user.role)}
      </div>
    </div>

    ${previewFieldHtml("email", "Email", escapeHtml(user.email))}
    ${previewFieldHtml("phone", "Телефон", escapeHtml(user.phone))}
    ${previewFieldHtml("calendar", "Дата реєстрації", formatDateTime(user.createdAt))}

    <h3 class="admin-preview__section-title">Додаткова інформація</h3>
    ${previewFieldHtml("orders", "Кількість замовлень", String(user.orderCount))}
    ${previewFieldHtml("wallet", "Загальна сума покупок", formatCurrency(user.totalSpent))}

    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-user-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-user-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-user-preview-edit-btn")?.addEventListener("click", () => {
    openUserModal(user.id);
  });

  document.getElementById("admin-user-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити користувача?",
        `Акаунт «${user.fullName}» (${user.email}) буде видалено безповоротно.`
      );
      if (!confirmed) return;
      const result = await deleteAdminUser(user.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewUserId = null;
      await loadAndRenderUsers();
    })();
  });
}

function highlightActiveUserRow(): void {
  const wrap = document.getElementById("admin-users-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", tr.dataset.rowId === previewUserId);
  });
}

function renderUsersTableBody(): void {
  const wrap = document.getElementById("admin-users-table-wrap");
  if (!wrap) return;

  if (!allUsers.length) {
    wrap.innerHTML = EMPTY_USERS_HTML;
    renderUserPagination(0);
    return;
  }

  const filtered = filteredUsers();
  const totalPages = Math.max(1, Math.ceil(filtered.length / USER_PAGE_SIZE));
  if (userPage > totalPages) userPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      userSearchQuery
    )}».</div>`;
    renderUserPagination(0);
    return;
  }

  const pageItems = filtered.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE);
  const rowsHtml = pageItems.map(userRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${USER_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>Користувач</th>
            <th>Телефон</th>
            <th>Роль</th>
            <th>Дата реєстрації</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderUserPagination(filtered.length);
}

function setupUserTableEvents(): void {
  const wrap = document.getElementById("admin-users-table-wrap");
  if (!wrap) return;

  const openPreview = (id: string): void => {
    previewUserId = id;
    highlightActiveUserRow();
    renderUserPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(String(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      openUserModal(String(editBtn.dataset.edit));
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = String(deleteBtn.dataset.delete);
      const user = allUsers.find((u) => u.id === id);
      if (!user) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити користувача?",
          `Акаунт «${user.fullName}» (${user.email}) буде видалено безповоротно.`
        );
        if (!confirmed) return;
        const result = await deleteAdminUser(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewUserId === id) previewUserId = null;
        await loadAndRenderUsers();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(String(row.dataset.rowId));
    }
  });
}

async function loadAndRenderUsers(): Promise<void> {
  allUsers = await getAdminUsers();
  if (previewUserId !== null && !allUsers.some((u) => u.id === previewUserId)) {
    previewUserId = null;
  }
  renderUsersTableBody();
  renderUserPreviewPanel();
}

function setupUserSearch(): void {
  const input = document.getElementById("admin-user-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-user-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    userSearchQuery = input.value;
    userPage = 1;
    syncClearBtn();
    renderUsersTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    userSearchQuery = "";
    userPage = 1;
    syncClearBtn();
    renderUsersTableBody();
    input.focus();
  });

  syncClearBtn();
}

// ---- Модалка редагування користувача (імʼя + телефон) ----
//
// Навмисно без створення акаунтів: користувачі реєструються самі, а
// адмін лише править контактні дані. Email тут теж не редагується — це
// логін (UNIQUE у схемі), його зміна вимагала б підтвердження пошти,
// тож показуємо його тільки для довідки, полем-«читалкою».

let userModalId: string | null = null;

function onUserModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeUserModal();
}

function openUserModal(id: string): void {
  const modal = document.getElementById("admin-user-modal");
  const nameInput = document.getElementById("admin-user-name") as HTMLInputElement | null;
  const phoneInput = document.getElementById("admin-user-phone") as HTMLInputElement | null;
  const emailHint = document.getElementById("admin-user-email-hint");
  const nameError = document.getElementById("admin-user-name-error");
  const phoneError = document.getElementById("admin-user-phone-error");
  const message = document.getElementById("admin-user-message");
  if (!modal || !nameInput || !phoneInput) return;

  const user = allUsers.find((u) => u.id === id);
  if (!user) return;

  userModalId = id;

  if (nameError) nameError.textContent = "";
  if (phoneError) phoneError.textContent = "";
  nameInput.classList.remove("input--invalid");
  phoneInput.classList.remove("input--invalid");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  nameInput.value = user.fullName;
  phoneInput.value = user.phone;
  if (emailHint) emailHint.textContent = user.email;

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onUserModalKeydown);
  nameInput.focus();
}

function closeUserModal(): void {
  const modal = document.getElementById("admin-user-modal");
  if (!modal) return;
  userModalId = null;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onUserModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupUserModal(): void {
  const modal = document.getElementById("admin-user-modal");
  const closeBtn = document.getElementById("admin-user-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closeUserModal);
  backdrop?.addEventListener("click", closeUserModal);

  const form = document.getElementById("admin-user-form") as HTMLFormElement | null;
  const nameInput = document.getElementById("admin-user-name") as HTMLInputElement | null;
  const phoneInput = document.getElementById("admin-user-phone") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-user-name-error");
  const phoneError = document.getElementById("admin-user-phone-error");
  const message = document.getElementById("admin-user-message");
  if (!form || !nameInput || !phoneInput) return;

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!userModalId) return;

    const fullName = nameInput.value.trim();
    const phone = phoneInput.value.trim();

    // Та сама перевірка, що й на реєстрації (server.js їх усе одно
    // продублює) — просто щоб не ганяти запит заради очевидної помилки.
    let valid = true;
    if (fullName.length < 2) {
      if (nameError) nameError.textContent = "Введіть ім'я та прізвище";
      nameInput.classList.add("input--invalid");
      valid = false;
    } else {
      if (nameError) nameError.textContent = "";
      nameInput.classList.remove("input--invalid");
    }

    if (!/^\+?\d{9,13}$/.test(phone.replace(/[\s()-]/g, ""))) {
      if (phoneError) phoneError.textContent = "Введіть коректний номер телефону";
      phoneInput.classList.add("input--invalid");
      valid = false;
    } else {
      if (phoneError) phoneError.textContent = "";
      phoneInput.classList.remove("input--invalid");
    }

    if (!valid) return;

    void (async () => {
      const result = await updateAdminUser(userModalId as string, { fullName, phone });
      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      closeUserModal();
      await loadAndRenderUsers();
    })();
  });
}

function renderUsersTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  userSearchQuery = "";
  userPage = 1;
  previewUserId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Користувачі</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Зареєстровані користувачі системи — покупці й адміністратори.</p>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-user-search" class="admin-table-search" placeholder="Пошук за ім'ям, email або телефоном…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-user-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-users-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-users-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-user-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });

  setupUserSearch();
  setupUserTableEvents();
  void loadAndRenderUsers();
}

// ==============================
// "Сесії" — лише перегляд + примусове завершення сесії (видалення
// рядка). Так само без модалки додавання — сесія створюється сама при
// вході, вручну тут нічого не заводять.
// ==============================

let allSessions: ApiAdminSession[] = [];
let sessionSearchQuery = "";
let sessionPage = 1;
let previewSessionToken: string | null = null;
const SESSION_PAGE_SIZE = 8;

function filteredSessions(): ApiAdminSession[] {
  const q = sessionSearchQuery.trim().toLowerCase();
  if (!q) return allSessions;
  return allSessions.filter(
    (s) => s.userFullName.toLowerCase().includes(q) || s.userEmail.toLowerCase().includes(q)
  );
}

function sessionStatusBadgeHtml(expiresAt: number): string {
  const active = expiresAt > Date.now();
  return `<span class="admin-table__badge${active ? " admin-table__badge--success" : ""}">${
    active ? "Активна" : "Завершена"
  }</span>`;
}

function sessionRowHtml(s: ApiAdminSession): string {
  return `
    <tr class="${s.token === previewSessionToken ? "admin-table__row--active" : ""}" data-row-id="${escapeHtml(s.token)}">
      <td class="admin-table__user-cell" title="${escapeHtml(s.userFullName)}">
        <span class="admin-table__user-name">${escapeHtml(s.userFullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(s.userEmail)}</span>
      </td>
      <td class="admin-table__description-cell">${formatDateTimeShort(s.createdAt)}</td>
      <td class="admin-table__description-cell">${formatDateTimeShort(s.expiresAt)}</td>
      <td class="admin-table__description-cell admin-table__badge-cell">${sessionStatusBadgeHtml(s.expiresAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${escapeHtml(s.token)}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${escapeHtml(s.token)}" type="button" aria-label="Завершити сесію">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Завершити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

// Дати в рядках тепер у короткому форматі (formatDateTimeShort), тож
// колонки вужчі — разом із панеллю перегляду праворуч таблиця влазить
// у картку без горизонтального скролу (та сама причина, що й у
// USER_TABLE_COLGROUP). Остання колонка — 2 кнопки по 36px.
const SESSION_TABLE_COLGROUP = `
  <colgroup>
    <col />
    <col style="width:120px" />
    <col style="width:120px" />
    <col style="width:120px" />
    <col style="width:110px" />
  </colgroup>`;

const EMPTY_SESSIONS_HTML = `<div class="admin-categories-empty">Активних сесій ще немає.</div>`;

function renderSessionPagination(filteredCount: number): void {
  const el = document.getElementById("admin-sessions-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / SESSION_PAGE_SIZE));
  const start = (sessionPage - 1) * SESSION_PAGE_SIZE + 1;
  const end = Math.min(sessionPage * SESSION_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(filteredCount)}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === sessionPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-session-page-prev" type="button" aria-label="Попередня сторінка" ${
        sessionPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-session-page-next" type="button" aria-label="Наступна сторінка" ${
        sessionPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-session-page-prev")?.addEventListener("click", () => {
    if (sessionPage > 1) {
      sessionPage--;
      renderSessionsTableBody();
    }
  });
  document.getElementById("admin-session-page-next")?.addEventListener("click", () => {
    if (sessionPage < totalPages) {
      sessionPage++;
      renderSessionsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sessionPage = Number(btn.dataset.page);
      renderSessionsTableBody();
    });
  });
}

// Після завершення сесії — перевіряємо, чи це була саме ПОТОЧНА сесія
// адміна (той самий httpOnly-токен, яким і зроблено цей запит):
// getSession() ходить на /api/session, яке дивиться на сесію по кукі
// в БД, тож якщо адмін щойно видалив чужу сесію — кука лишається
// робочою і getSession() поверне того ж адміна; якщо ж видалив свою
// власну (в тому числі через "Завершити" на своєму ж рядку) — кука
// вже нікуди не веде, і саме тоді кидаємо на головну сторінку сайту.
// Для чужої сесії просто оновлюємо список на місці.
async function handleSessionDeleted(): Promise<void> {
  const stillLoggedIn = await getSession();
  if (!stillLoggedIn) {
    window.location.href = "index.html";
    return;
  }
  await loadAndRenderSessions();
}

function renderSessionPreviewPanel(): void {
  const panel = document.getElementById("admin-session-preview");
  if (!panel) return;

  const session = allSessions.find((s) => s.token === previewSessionToken);
  if (!session) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть сесію зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(
        session.userFullName.trim().charAt(0).toUpperCase() || "?"
      )}</span>
      <div>
        <h2 class="admin-preview__name">${escapeHtml(session.userFullName)}</h2>
        ${sessionStatusBadgeHtml(session.expiresAt)}
      </div>
    </div>

    ${previewFieldHtml("email", "Email", escapeHtml(session.userEmail))}
    ${previewFieldHtml("key", "Токен", `${escapeHtml(session.token.slice(0, 10))}…`)}
    ${previewFieldHtml("calendar", "Створено", formatDateTime(session.createdAt))}
    ${previewFieldHtml("clock", "Діє до", formatDateTime(session.expiresAt))}
    ${previewFieldHtml("shield", "Статус", sessionStatusBadgeHtml(session.expiresAt))}
    <div class="admin-preview__actions">
      <button class="btn btn--danger" id="admin-session-preview-delete-btn" type="button">Завершити сесію</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-session-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Завершити сесію?",
        `Сесію користувача «${session.userFullName}» буде завершено — йому доведеться увійти знову.`
      );
      if (!confirmed) return;
      const result = await deleteAdminSession(session.token);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewSessionToken = null;
      await handleSessionDeleted();
    })();
  });
}

function highlightActiveSessionRow(): void {
  const wrap = document.getElementById("admin-sessions-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", tr.dataset.rowId === previewSessionToken);
  });
}

function renderSessionsTableBody(): void {
  const wrap = document.getElementById("admin-sessions-table-wrap");
  if (!wrap) return;

  if (!allSessions.length) {
    wrap.innerHTML = EMPTY_SESSIONS_HTML;
    renderSessionPagination(0);
    return;
  }

  const filtered = filteredSessions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / SESSION_PAGE_SIZE));
  if (sessionPage > totalPages) sessionPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      sessionSearchQuery
    )}».</div>`;
    renderSessionPagination(0);
    return;
  }

  const pageItems = filtered.slice((sessionPage - 1) * SESSION_PAGE_SIZE, sessionPage * SESSION_PAGE_SIZE);
  const rowsHtml = pageItems.map(sessionRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${SESSION_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>Користувач</th>
            <th>Створено</th>
            <th>Діє до</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderSessionPagination(filtered.length);
}

function setupSessionTableEvents(): void {
  const wrap = document.getElementById("admin-sessions-table-wrap");
  if (!wrap) return;

  const openPreview = (token: string): void => {
    previewSessionToken = token;
    highlightActiveSessionRow();
    renderSessionPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(String(previewBtn.dataset.preview));
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const token = String(deleteBtn.dataset.delete);
      const session = allSessions.find((s) => s.token === token);
      if (!session) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Завершити сесію?",
          `Сесію користувача «${session.userFullName}» буде завершено — йому доведеться увійти знову.`
        );
        if (!confirmed) return;
        const result = await deleteAdminSession(token);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewSessionToken === token) previewSessionToken = null;
        await handleSessionDeleted();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(String(row.dataset.rowId));
    }
  });
}

async function loadAndRenderSessions(): Promise<void> {
  allSessions = await getAdminSessions();
  if (previewSessionToken !== null && !allSessions.some((s) => s.token === previewSessionToken)) {
    previewSessionToken = null;
  }
  renderSessionsTableBody();
  renderSessionPreviewPanel();
}

function setupSessionSearch(): void {
  const input = document.getElementById("admin-session-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-session-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    sessionSearchQuery = input.value;
    sessionPage = 1;
    syncClearBtn();
    renderSessionsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    sessionSearchQuery = "";
    sessionPage = 1;
    syncClearBtn();
    renderSessionsTableBody();
    input.focus();
  });

  syncClearBtn();
}

function renderSessionsTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  sessionSearchQuery = "";
  sessionPage = 1;
  previewSessionToken = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Сесії</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Активні й завершені сесії користувачів — можна примусово завершити будь-яку.</p>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-session-search" class="admin-table-search" placeholder="Пошук за користувачем або email…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-session-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-sessions-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-sessions-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-session-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });

  setupSessionSearch();
  setupSessionTableEvents();
  void loadAndRenderSessions();
}

// ==============================
// Інгредієнти (склад) — повний CRUD: список + панель перегляду
// праворуч + модалка додавання/редагування (той самий підхід, що й у
// тегів, тільки замість іконки — числові поля "одиниця виміру",
// "залишок на складі", "поріг низького залишку").
// ==============================

let allIngredients: ApiIngredient[] = [];
let ingredientSearchQuery = "";
let ingredientPage = 1;
let previewIngredientId: number | null = null;
const INGREDIENT_PAGE_SIZE = 8;

type IngredientModalMode = { type: "create" } | { type: "edit"; id: number };
let ingredientModalMode: IngredientModalMode = { type: "create" };
let ingredientModalIconUrl: string | null = null;

function renderIngredientModalIconPreview(): void {
  const previewSlot = document.getElementById("admin-ingredient-icon-preview");
  const clearBtn = document.getElementById("admin-ingredient-icon-clear") as HTMLButtonElement | null;
  if (previewSlot) previewSlot.innerHTML = categoryIconPreviewHtml(ingredientModalIconUrl);
  if (clearBtn) clearBtn.hidden = !ingredientModalIconUrl;
}

// Той самий пікер, що й у категорій/тегів (setupCategoryModalIconPicker
// вище) — лише під kind "ingredients", тож файли лягають у окрему
// директорію assets/icons/ingredients/.
function setupIngredientModalIconPicker(): void {
  const fileInput = document.getElementById("admin-ingredient-icon-file") as HTMLInputElement | null;
  const status = document.getElementById("admin-ingredient-icon-status");
  const clearBtn = document.getElementById("admin-ingredient-icon-clear");
  if (!fileInput) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (status) status.textContent = "Завантаження…";

    void (async () => {
      const result = await uploadIcon(file, "ingredients");
      fileInput.value = "";

      if (!result.ok) {
        if (status) status.textContent = result.error;
        return;
      }

      if (status) status.textContent = "";
      ingredientModalIconUrl = result.url;
      renderIngredientModalIconPreview();
    })();
  });

  clearBtn?.addEventListener("click", () => {
    ingredientModalIconUrl = null;
    if (status) status.textContent = "";
    renderIngredientModalIconPreview();
  });
}

function filteredIngredients(): ApiIngredient[] {
  const q = ingredientSearchQuery.trim().toLowerCase();
  if (!q) return allIngredients;
  return allIngredients.filter((i) => i.name.toLowerCase().includes(q));
}

// Бейдж "Мало на складі" — коли є поріг і залишок його не перевищує.
// Той самий візуальний прийом, що роль/статус в інших таблицях, лише
// зворотний за змістом кольору (--error замість --success/--accent).
function stockBadgeHtml(i: ApiIngredient): string {
  const low = i.lowStockThreshold !== null && i.stockQuantity <= i.lowStockThreshold;
  if (!low) return `${formatQuantity(i.stockQuantity)} ${escapeHtml(i.unit)}`;
  return `<span class="admin-table__badge admin-table__badge--warning">${formatQuantity(
    i.stockQuantity
  )} ${escapeHtml(i.unit)} — мало</span>`;
}

function formatQuantity(n: number): string {
  return n.toLocaleString("uk-UA", { maximumFractionDigits: 3 });
}

function ingredientRowHtml(i: ApiIngredient): string {
  const icon = i.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${i.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${i.id === previewIngredientId ? "admin-table__row--active" : ""}" data-row-id="${i.id}">
      <td class="admin-table__id-cell">${i.id}</td>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell admin-table__name-cell--flex" title="${escapeHtml(i.name)}">${escapeHtml(i.name)}</td>
      <td class="admin-table__stock-cell" title="${escapeHtml(i.unit)}">${stockBadgeHtml(i)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${i.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${i.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${i.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

const INGREDIENT_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:56px" />
    <col />
    <col style="width:180px" />
    <col style="width:150px" />
  </colgroup>`;

const EMPTY_INGREDIENTS_HTML = `
  <div class="admin-categories-empty">Інгредієнтів ще немає.<br />Додайте перший кнопкою вище.</div>`;

function renderIngredientPagination(filteredCount: number): void {
  const el = document.getElementById("admin-ingredients-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / INGREDIENT_PAGE_SIZE));
  const start = (ingredientPage - 1) * INGREDIENT_PAGE_SIZE + 1;
  const end = Math.min(ingredientPage * INGREDIENT_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(
    filteredCount
  )}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === ingredientPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-ingredient-page-prev" type="button" aria-label="Попередня сторінка" ${
        ingredientPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-ingredient-page-next" type="button" aria-label="Наступна сторінка" ${
        ingredientPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-ingredient-page-prev")?.addEventListener("click", () => {
    if (ingredientPage > 1) {
      ingredientPage--;
      renderIngredientsTableBody();
    }
  });
  document.getElementById("admin-ingredient-page-next")?.addEventListener("click", () => {
    if (ingredientPage < totalPages) {
      ingredientPage++;
      renderIngredientsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ingredientPage = Number(btn.dataset.page);
      renderIngredientsTableBody();
    });
  });
}

function renderIngredientPreviewPanel(): void {
  const panel = document.getElementById("admin-ingredient-preview");
  if (!panel) return;

  const ingredient = allIngredients.find((i) => i.id === previewIngredientId);
  if (!ingredient) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть інгредієнт зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const icon = ingredient.iconUrl
    ? `<img class="admin-preview__icon skeleton" src="${ingredient.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;

  panel.innerHTML = `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(ingredient.name)}</h2>
      <span class="admin-preview__id">ID: ${ingredient.id}</span>
    </div>
    ${icon}
    ${previewFieldHtml("hash", "Одиниця виміру", escapeHtml(ingredient.unit))}
    ${previewFieldHtml(
      "orders",
      "Залишок на складі",
      `${formatQuantity(ingredient.stockQuantity)} ${escapeHtml(ingredient.unit)}`
    )}
    ${previewFieldHtml(
      "shield",
      "Поріг низького залишку",
      ingredient.lowStockThreshold === null
        ? "Не задано"
        : `${formatQuantity(ingredient.lowStockThreshold)} ${escapeHtml(ingredient.unit)}`
    )}
    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-ingredient-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-ingredient-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-ingredient-preview-edit-btn")?.addEventListener("click", () => {
    openIngredientModal({ type: "edit", id: ingredient.id });
  });

  document.getElementById("admin-ingredient-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити інгредієнт?",
        `Інгредієнт «${ingredient.name}» буде видалено безповоротно.`
      );
      if (!confirmed) return;
      const result = await deleteIngredient(ingredient.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewIngredientId = null;
      await loadAndRenderIngredients();
    })();
  });
}

function highlightActiveIngredientRow(): void {
  const wrap = document.getElementById("admin-ingredients-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewIngredientId);
  });
}

function renderIngredientsTableBody(): void {
  const wrap = document.getElementById("admin-ingredients-table-wrap");
  if (!wrap) return;

  if (!allIngredients.length) {
    wrap.innerHTML = EMPTY_INGREDIENTS_HTML;
    renderIngredientPagination(0);
    return;
  }

  const filtered = filteredIngredients();
  const totalPages = Math.max(1, Math.ceil(filtered.length / INGREDIENT_PAGE_SIZE));
  if (ingredientPage > totalPages) ingredientPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      ingredientSearchQuery
    )}».</div>`;
    renderIngredientPagination(0);
    return;
  }

  const pageItems = filtered.slice(
    (ingredientPage - 1) * INGREDIENT_PAGE_SIZE,
    ingredientPage * INGREDIENT_PAGE_SIZE
  );
  const rowsHtml = pageItems.map(ingredientRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${INGREDIENT_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>ID</th>
            <th></th>
            <th>Назва</th>
            <th>Залишок</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderIngredientPagination(filtered.length);
}

function setupIngredientTableEvents(): void {
  const wrap = document.getElementById("admin-ingredients-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewIngredientId = id;
    highlightActiveIngredientRow();
    renderIngredientPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      const id = Number(editBtn.dataset.edit);
      if (allIngredients.some((i) => i.id === id)) openIngredientModal({ type: "edit", id });
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const ingredient = allIngredients.find((i) => i.id === id);
      if (!ingredient) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити інгредієнт?",
          `Інгредієнт «${ingredient.name}» буде видалено безповоротно.`
        );
        if (!confirmed) return;
        const result = await deleteIngredient(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewIngredientId === id) previewIngredientId = null;
        await loadAndRenderIngredients();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderIngredients(): Promise<void> {
  allIngredients = await getIngredients();
  if (previewIngredientId !== null && !allIngredients.some((i) => i.id === previewIngredientId)) {
    previewIngredientId = null;
  }
  renderIngredientsTableBody();
  renderIngredientPreviewPanel();
}

function setupIngredientSearch(): void {
  const input = document.getElementById("admin-ingredient-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-ingredient-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    ingredientSearchQuery = input.value;
    ingredientPage = 1;
    syncClearBtn();
    renderIngredientsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    ingredientSearchQuery = "";
    ingredientPage = 1;
    syncClearBtn();
    renderIngredientsTableBody();
    input.focus();
  });

  syncClearBtn();
}

// ---- Модалка додавання/редагування інгредієнта ----

function onIngredientModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeIngredientModal();
}

function openIngredientModal(mode: IngredientModalMode): void {
  const modal = document.getElementById("admin-ingredient-modal");
  const title = document.getElementById("admin-ingredient-modal-title");
  const submitBtn = document.getElementById("admin-ingredient-modal-submit");
  const nameInput = document.getElementById("admin-ingredient-name") as HTMLInputElement | null;
  const unitInput = document.getElementById("admin-ingredient-unit") as HTMLSelectElement | null;
  const stockInput = document.getElementById("admin-ingredient-stock") as HTMLInputElement | null;
  const thresholdInput = document.getElementById("admin-ingredient-threshold") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-ingredient-name-error");
  const message = document.getElementById("admin-ingredient-message");
  if (!modal || !nameInput || !unitInput || !stockInput || !thresholdInput) return;

  ingredientModalMode = mode;

  if (nameError) nameError.textContent = "";
  nameInput.classList.remove("input--invalid");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }

  if (mode.type === "edit") {
    const ingredient = allIngredients.find((i) => i.id === mode.id);
    if (!ingredient) return;
    if (title) title.textContent = "Редагувати інгредієнт";
    if (submitBtn) submitBtn.textContent = "Зберегти";
    nameInput.value = ingredient.name;
    unitInput.value = ingredient.unit;
    stockInput.value = String(ingredient.stockQuantity);
    thresholdInput.value = ingredient.lowStockThreshold === null ? "" : String(ingredient.lowStockThreshold);
    ingredientModalIconUrl = ingredient.iconUrl;
  } else {
    if (title) title.textContent = "Додати інгредієнт";
    if (submitBtn) submitBtn.textContent = "Додати інгредієнт";
    nameInput.value = "";
    unitInput.value = "кг";
    stockInput.value = "0";
    thresholdInput.value = "";
    ingredientModalIconUrl = null;
  }
  renderIngredientModalIconPreview();

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onIngredientModalKeydown);
  nameInput.focus();
}

function closeIngredientModal(): void {
  const modal = document.getElementById("admin-ingredient-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onIngredientModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupIngredientModal(): void {
  const modal = document.getElementById("admin-ingredient-modal");
  const closeBtn = document.getElementById("admin-ingredient-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closeIngredientModal);
  backdrop?.addEventListener("click", closeIngredientModal);
  setupIngredientModalIconPicker();

  const form = document.getElementById("admin-ingredient-form") as HTMLFormElement | null;
  const nameInput = document.getElementById("admin-ingredient-name") as HTMLInputElement | null;
  const unitInput = document.getElementById("admin-ingredient-unit") as HTMLSelectElement | null;
  const stockInput = document.getElementById("admin-ingredient-stock") as HTMLInputElement | null;
  const thresholdInput = document.getElementById("admin-ingredient-threshold") as HTMLInputElement | null;
  const nameError = document.getElementById("admin-ingredient-name-error");
  const message = document.getElementById("admin-ingredient-message");
  if (!form || !nameInput || !unitInput || !stockInput || !thresholdInput) return;

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = nameInput.value.trim();
    if (name.length < 2) {
      if (nameError) nameError.textContent = "Введіть назву інгредієнта";
      nameInput.classList.add("input--invalid");
      return;
    }
    if (nameError) nameError.textContent = "";
    nameInput.classList.remove("input--invalid");

    const unit = unitInput.value.trim();
    const stockQuantity = Number(stockInput.value);
    const thresholdRaw = thresholdInput.value.trim();
    const lowStockThreshold = thresholdRaw === "" ? null : Number(thresholdRaw);

    void (async () => {
      const input = { name, unit, stockQuantity, lowStockThreshold, iconUrl: ingredientModalIconUrl ?? "" };
      const result =
        ingredientModalMode.type === "edit"
          ? await updateIngredient(ingredientModalMode.id, input)
          : await createIngredient(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      closeIngredientModal();
      await loadAndRenderIngredients();
    })();
  });
}

function renderIngredientsTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  ingredientSearchQuery = "";
  ingredientPage = 1;
  previewIngredientId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Інгредієнти</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Сировина на складі — облік залишків для виробництва продуктів.</p>
          <button class="btn btn--primary-sm admin-add-btn" id="admin-add-ingredient-btn" type="button">+ Додати інгредієнт</button>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-ingredient-search" class="admin-table-search" placeholder="Пошук інгредієнтів за назвою…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-ingredient-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-ingredients-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-ingredients-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-ingredient-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-add-ingredient-btn")?.addEventListener("click", () => {
    openIngredientModal({ type: "create" });
  });

  setupIngredientSearch();
  setupIngredientTableEvents();
  void loadAndRenderIngredients();
}

// ==============================
// Способи оплати — лише перегляд + видалення (див. коментар біля
// роутів server.js: створює й редагує СВІЙ спосіб оплати тільки сам
// покупець, з попапу в шапці сайту — не адмінка).
// ==============================

let allPaymentMethods: ApiAdminPaymentMethod[] = [];
let paymentMethodSearchQuery = "";
let paymentMethodPage = 1;
let previewPaymentMethodId: number | null = null;
const PAYMENT_METHOD_PAGE_SIZE = 8;

const PAYMENT_METHOD_TYPE_LABELS: Record<string, string> = {
  card: "Банківська картка",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Готівка кур'єру",
};

function paymentMethodTypeLabel(type: string): string {
  return PAYMENT_METHOD_TYPE_LABELS[type] ?? type;
}

function filteredPaymentMethods(): ApiAdminPaymentMethod[] {
  const q = paymentMethodSearchQuery.trim().toLowerCase();
  if (!q) return allPaymentMethods;
  return allPaymentMethods.filter(
    (p) => p.userFullName.toLowerCase().includes(q) || p.userEmail.toLowerCase().includes(q)
  );
}

function defaultBadgeHtml(isDefault: boolean): string {
  return `<span class="admin-table__badge${isDefault ? " admin-table__badge--accent" : ""}">${
    isDefault ? "Основний" : "Додатковий"
  }</span>`;
}

function paymentMethodRowHtml(p: ApiAdminPaymentMethod): string {
  return `
    <tr class="${p.id === previewPaymentMethodId ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
      <td class="admin-table__user-cell" title="${escapeHtml(p.userFullName)}">
        <span class="admin-table__user-name">${escapeHtml(p.userFullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(p.userEmail)}</span>
      </td>
      <td class="admin-table__description-cell">${escapeHtml(paymentMethodTypeLabel(p.type))}</td>
      <td class="admin-table__description-cell">${escapeHtml(p.label ?? "—")}</td>
      <td class="admin-table__description-cell admin-table__badge-cell">${defaultBadgeHtml(p.isDefault)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${p.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${p.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

const PAYMENT_METHOD_TABLE_COLGROUP = `
  <colgroup>
    <col />
    <col style="width:150px" />
    <col style="width:140px" />
    <col style="width:120px" />
    <col style="width:110px" />
  </colgroup>`;

const EMPTY_PAYMENT_METHODS_HTML = `<div class="admin-categories-empty">Способів оплати ще немає — їх додають самі покупці зі свого меню.</div>`;

function renderPaymentMethodPagination(filteredCount: number): void {
  const el = document.getElementById("admin-payment-methods-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAYMENT_METHOD_PAGE_SIZE));
  const start = (paymentMethodPage - 1) * PAYMENT_METHOD_PAGE_SIZE + 1;
  const end = Math.min(paymentMethodPage * PAYMENT_METHOD_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(
    filteredCount
  )}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === paymentMethodPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-payment-method-page-prev" type="button" aria-label="Попередня сторінка" ${
        paymentMethodPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-payment-method-page-next" type="button" aria-label="Наступна сторінка" ${
        paymentMethodPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-payment-method-page-prev")?.addEventListener("click", () => {
    if (paymentMethodPage > 1) {
      paymentMethodPage--;
      renderPaymentMethodsTableBody();
    }
  });
  document.getElementById("admin-payment-method-page-next")?.addEventListener("click", () => {
    if (paymentMethodPage < totalPages) {
      paymentMethodPage++;
      renderPaymentMethodsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      paymentMethodPage = Number(btn.dataset.page);
      renderPaymentMethodsTableBody();
    });
  });
}

function renderPaymentMethodPreviewPanel(): void {
  const panel = document.getElementById("admin-payment-method-preview");
  if (!panel) return;

  const method = allPaymentMethods.find((p) => p.id === previewPaymentMethodId);
  if (!method) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть спосіб оплати зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  panel.innerHTML = `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(
        method.userFullName.trim().charAt(0).toUpperCase() || "?"
      )}</span>
      <div>
        <h2 class="admin-preview__name">${escapeHtml(method.userFullName)}</h2>
        ${defaultBadgeHtml(method.isDefault)}
      </div>
    </div>

    ${previewFieldHtml("email", "Email власника", escapeHtml(method.userEmail))}
    ${previewFieldHtml("wallet", "Тип", escapeHtml(paymentMethodTypeLabel(method.type)))}
    ${previewFieldHtml("tag", "Назва", escapeHtml(method.label ?? "—"))}
    ${previewFieldHtml("calendar", "Додано", formatDateTime(method.createdAt))}

    <div class="admin-preview__actions">
      <button class="btn btn--danger" id="admin-payment-method-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-payment-method-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити спосіб оплати?",
        `Спосіб оплати «${paymentMethodTypeLabel(method.type)}» користувача «${
          method.userFullName
        }» буде видалено безповоротно.`
      );
      if (!confirmed) return;
      const result = await deleteAdminPaymentMethod(method.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewPaymentMethodId = null;
      await loadAndRenderPaymentMethods();
    })();
  });
}

function highlightActivePaymentMethodRow(): void {
  const wrap = document.getElementById("admin-payment-methods-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewPaymentMethodId);
  });
}

function renderPaymentMethodsTableBody(): void {
  const wrap = document.getElementById("admin-payment-methods-table-wrap");
  if (!wrap) return;

  if (!allPaymentMethods.length) {
    wrap.innerHTML = EMPTY_PAYMENT_METHODS_HTML;
    renderPaymentMethodPagination(0);
    return;
  }

  const filtered = filteredPaymentMethods();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAYMENT_METHOD_PAGE_SIZE));
  if (paymentMethodPage > totalPages) paymentMethodPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      paymentMethodSearchQuery
    )}».</div>`;
    renderPaymentMethodPagination(0);
    return;
  }

  const pageItems = filtered.slice(
    (paymentMethodPage - 1) * PAYMENT_METHOD_PAGE_SIZE,
    paymentMethodPage * PAYMENT_METHOD_PAGE_SIZE
  );
  const rowsHtml = pageItems.map(paymentMethodRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${PAYMENT_METHOD_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>Користувач</th>
            <th>Тип</th>
            <th>Назва</th>
            <th>Основний</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderPaymentMethodPagination(filtered.length);
}

function setupPaymentMethodTableEvents(): void {
  const wrap = document.getElementById("admin-payment-methods-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewPaymentMethodId = id;
    highlightActivePaymentMethodRow();
    renderPaymentMethodPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const method = allPaymentMethods.find((p) => p.id === id);
      if (!method) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити спосіб оплати?",
          `Спосіб оплати «${paymentMethodTypeLabel(method.type)}» користувача «${
            method.userFullName
          }» буде видалено безповоротно.`
        );
        if (!confirmed) return;
        const result = await deleteAdminPaymentMethod(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewPaymentMethodId === id) previewPaymentMethodId = null;
        await loadAndRenderPaymentMethods();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderPaymentMethods(): Promise<void> {
  allPaymentMethods = await getAdminPaymentMethods();
  if (
    previewPaymentMethodId !== null &&
    !allPaymentMethods.some((p) => p.id === previewPaymentMethodId)
  ) {
    previewPaymentMethodId = null;
  }
  renderPaymentMethodsTableBody();
  renderPaymentMethodPreviewPanel();
}

function setupPaymentMethodSearch(): void {
  const input = document.getElementById("admin-payment-method-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-payment-method-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    paymentMethodSearchQuery = input.value;
    paymentMethodPage = 1;
    syncClearBtn();
    renderPaymentMethodsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    paymentMethodSearchQuery = "";
    paymentMethodPage = 1;
    syncClearBtn();
    renderPaymentMethodsTableBody();
    input.focus();
  });

  syncClearBtn();
}

function renderPaymentMethodsTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  paymentMethodSearchQuery = "";
  paymentMethodPage = 1;
  previewPaymentMethodId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Методи оплати</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Способи оплати додають самі покупці зі свого меню — тут лише перегляд і видалення.</p>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-payment-method-search" class="admin-table-search" placeholder="Пошук за користувачем або email…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-payment-method-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-payment-methods-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-payment-methods-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-payment-method-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });

  setupPaymentMethodSearch();
  setupPaymentMethodTableEvents();
  void loadAndRenderPaymentMethods();
}

// ==============================
// Список бажаного / Кошики / Предмети кошика — три таблиці з ідентичним
// патерном "лише перегляд + видалення" (наповнює сам покупець на сайті,
// не адмін — той самий підхід, що й Методи оплати вище). Замість ще
// трьох майже однакових ~300-рядкових копій пошуку/пагінації/прев'ю —
// одна фабрика з невеликим конфігом на кожну таблицю.
// ==============================

interface SimpleAdminTableConfig<T> {
  title: string;
  hint: string;
  searchPlaceholder: string;
  emptyHtml: string;
  theadHtml: string;
  colgroupHtml: string;
  pageSize: number;
  fetchAll: () => Promise<T[]>;
  // Відсутні — таблиця "тільки перегляд" (Рецепти продуктів/Теги
  // продуктів): фабрика просто не малює кнопку видалення ні в рядку
  // (rowHtml сам вирішує, малювати її чи ні), ні в прев'ю-панелі.
  deleteOne?: (id: number) => Promise<DeleteResult>;
  getId: (item: T) => number;
  matchesQuery: (item: T, q: string) => boolean;
  rowHtml: (item: T, isActive: boolean) => string;
  // Прев'ю без самої кнопки видалення знизу — її додає фабрика (коли
  // deleteOne заданий), щоб текст підтвердження й обробник були в
  // одному місці.
  previewBodyHtml: (item: T) => string;
  confirmTitle?: (item: T) => string;
  confirmMessage?: (item: T) => string;
}

function createSimpleAdminTable<T>(config: SimpleAdminTableConfig<T>): { render: () => void } {
  let all: T[] = [];
  let searchQuery = "";
  let page = 1;
  let previewId: number | null = null;

  const rootId = "admin-view";
  const wrapId = `admin-simple-${config.title}-wrap`; // унікально в межах одного відкритого view
  const paginationId = `admin-simple-${config.title}-pagination`;
  const previewPanelId = `admin-simple-${config.title}-preview`;
  const searchId = `admin-simple-${config.title}-search`;
  const clearId = `admin-simple-${config.title}-search-clear`;

  function filtered(): T[] {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => config.matchesQuery(item, q));
  }

  function highlightActiveRow(): void {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
      tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewId);
    });
  }

  function renderPagination(filteredCount: number): void {
    const el = document.getElementById(paginationId);
    if (!el) return;

    if (filteredCount === 0) {
      el.innerHTML = "";
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filteredCount / config.pageSize));
    const start = (page - 1) * config.pageSize + 1;
    const end = Math.min(page * config.pageSize, filteredCount);
    const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(
      filteredCount
    )}</p>`;

    if (totalPages <= 1) {
      el.innerHTML = summary;
      return;
    }

    let pageButtons = "";
    for (let p = 1; p <= totalPages; p++) {
      pageButtons += `<button class="admin-pagination__page${
        p === page ? " admin-pagination__page--active" : ""
      }" data-page="${p}" type="button">${p}</button>`;
    }

    el.innerHTML = `
      ${summary}
      <div class="admin-pagination__controls">
        <button class="admin-pagination__arrow" data-page-prev type="button" aria-label="Попередня сторінка" ${
          page === 1 ? "disabled" : ""
        }>‹</button>
        ${pageButtons}
        <button class="admin-pagination__arrow" data-page-next type="button" aria-label="Наступна сторінка" ${
          page === totalPages ? "disabled" : ""
        }>›</button>
      </div>`;

    el.querySelector("[data-page-prev]")?.addEventListener("click", () => {
      if (page > 1) {
        page--;
        renderTableBody();
      }
    });
    el.querySelector("[data-page-next]")?.addEventListener("click", () => {
      if (page < totalPages) {
        page++;
        renderTableBody();
      }
    });
    el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        page = Number(btn.dataset.page);
        renderTableBody();
      });
    });
  }

  async function handleDelete(item: T): Promise<void> {
    if (!config.deleteOne || !config.confirmTitle || !config.confirmMessage) return;
    const confirmed = await confirmDelete(config.confirmTitle(item), config.confirmMessage(item));
    if (!confirmed) return;
    const result = await config.deleteOne(config.getId(item));
    if (!result.ok) {
      await showAdminAlert("Помилка", result.error);
      return;
    }
    if (previewId === config.getId(item)) previewId = null;
    await loadAndRender();
  }

  function renderPreviewPanel(): void {
    const panel = document.getElementById(previewPanelId);
    if (!panel) return;

    const item = all.find((i) => config.getId(i) === previewId);
    if (!item) {
      panel.innerHTML = `<div class="admin-preview-empty">Оберіть рядок зі списку, щоб переглянути&nbsp;деталі.</div>`;
      return;
    }

    const deleteActionsHtml = config.deleteOne
      ? `<div class="admin-preview__actions">
          <button class="btn btn--danger" data-preview-delete type="button">Видалити</button>
        </div>`
      : "";

    panel.innerHTML = `${config.previewBodyHtml(item)}${deleteActionsHtml}`;
    animatePreviewPanelIn(panel);

    panel.querySelector("[data-preview-delete]")?.addEventListener("click", () => {
      void handleDelete(item);
    });
  }

  function renderTableBody(): void {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    if (!all.length) {
      wrap.innerHTML = config.emptyHtml;
      renderPagination(0);
      return;
    }

    const items = filtered();
    const totalPages = Math.max(1, Math.ceil(items.length / config.pageSize));
    if (page > totalPages) page = totalPages;

    if (!items.length) {
      wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
        searchQuery
      )}».</div>`;
      renderPagination(0);
      return;
    }

    const pageItems = items.slice((page - 1) * config.pageSize, page * config.pageSize);
    const rowsHtml = pageItems.map((item) => config.rowHtml(item, config.getId(item) === previewId)).join("");

    const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
    if (existingTbody) {
      reconcileTableRows(existingTbody, rowsHtml);
    } else {
      wrap.innerHTML = `
        <table class="admin-table">
          ${config.colgroupHtml}
          <thead>${config.theadHtml}</thead>
          <tbody>${rowsHtml}</tbody>
        </table>`;
    }

    renderPagination(items.length);
  }

  function setupTableEvents(): void {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    const openPreview = (id: number): void => {
      previewId = id;
      highlightActiveRow();
      renderPreviewPanel();
    };

    wrap.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;

      const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
      if (previewBtn) {
        openPreview(Number(previewBtn.dataset.preview));
        return;
      }

      const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.delete);
        const item = all.find((i) => config.getId(i) === id);
        if (!item) return;
        void handleDelete(item);
        return;
      }

      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
        if (row) openPreview(Number(row.dataset.rowId));
      }
    });
  }

  async function loadAndRender(): Promise<void> {
    all = await config.fetchAll();
    if (previewId !== null && !all.some((i) => config.getId(i) === previewId)) {
      previewId = null;
    }
    renderTableBody();
    renderPreviewPanel();
  }

  function setupSearch(): void {
    const input = document.getElementById(searchId) as HTMLInputElement | null;
    const clearBtn = document.getElementById(clearId) as HTMLButtonElement | null;
    if (!input) return;

    const syncClearBtn = (): void => {
      clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
    };

    input.addEventListener("input", () => {
      searchQuery = input.value;
      page = 1;
      syncClearBtn();
      renderTableBody();
    });

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      searchQuery = "";
      page = 1;
      syncClearBtn();
      renderTableBody();
      input.focus();
    });

    syncClearBtn();
  }

  function render(): void {
    const root = document.getElementById(rootId);
    if (!root) return;

    searchQuery = "";
    page = 1;
    previewId = null;

    root.innerHTML = `
      <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
      <h1 class="admin-page__title">${escapeHtml(config.title)}</h1>

      <div class="admin-categories-layout">
        <section class="admin-section admin-section--wide">
          <div class="admin-section__header">
            <p class="admin-section__hint">${escapeHtml(config.hint)}</p>
          </div>

          <div class="admin-table-toolbar">
            <div class="admin-search-wrap">
              <input type="text" id="${searchId}" class="admin-table-search" placeholder="${escapeHtml(
      config.searchPlaceholder
    )}" autocomplete="off" />
              <button class="admin-search-clear" id="${clearId}" type="button" aria-label="Очистити пошук">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>

          <div id="${wrapId}" class="admin-table-wrap"></div>
          <div id="${paginationId}" class="admin-pagination"></div>
        </section>

        <section class="admin-section admin-preview" id="${previewPanelId}"></section>
      </div>`;

    document.getElementById("admin-back-btn")?.addEventListener("click", () => {
      window.location.hash = "";
    });

    setupSearch();
    setupTableEvents();
    void loadAndRender();
  }

  return { render };
}

const wishlistsTable = createSimpleAdminTable<ApiAdminWishlistItem>({
  title: "Списки бажаного",
  hint: "Товари, які покупці додали в бажане ♥ на сторінці товару — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за користувачем або товаром…",
  emptyHtml: `<div class="admin-categories-empty">Списків бажаного ще немає.</div>`,
  theadHtml: `<tr><th>Користувач</th><th>Товар</th><th>Додано</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:170px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminWishlistItems,
  deleteOne: deleteAdminWishlistItem,
  getId: (i) => i.id,
  matchesQuery: (i, q) =>
    i.userFullName.toLowerCase().includes(q) ||
    i.userEmail.toLowerCase().includes(q) ||
    i.productName.toLowerCase().includes(q),
  rowHtml: (i, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${i.id}">
      <td class="admin-table__user-cell" title="${escapeHtml(i.userFullName)}">
        <span class="admin-table__user-name">${escapeHtml(i.userFullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(i.userEmail)}</span>
      </td>
      <td class="admin-table__description-cell">${escapeHtml(i.productName)}</td>
      <td class="admin-table__description-cell">${formatDateTime(i.createdAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${i.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${i.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (i) => `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(
        i.userFullName.trim().charAt(0).toUpperCase() || "?"
      )}</span>
      <div>
        <h2 class="admin-preview__name">${escapeHtml(i.userFullName)}</h2>
      </div>
    </div>
    ${previewFieldHtml("email", "Email", escapeHtml(i.userEmail))}
    ${previewFieldHtml("tag", "Товар", escapeHtml(i.productName))}
    ${previewFieldHtml("calendar", "Додано", formatDateTime(i.createdAt))}`,
  confirmTitle: () => "Видалити зі списку бажаного?",
  confirmMessage: (i) => `«${i.productName}» більше не буде в списку бажаного користувача «${i.userFullName}».`,
});

const cartsTable = createSimpleAdminTable<ApiAdminCart>({
  title: "Кошики",
  hint: "Активні кошики покупців — авторизованих та гостьових. Видалення кошику прибирає всі його товари.",
  searchPlaceholder: "Пошук за користувачем…",
  emptyHtml: `<div class="admin-categories-empty">Кошиків ще немає.</div>`,
  theadHtml: `<tr><th>Власник</th><th>Товарів</th><th>Створено</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col style="width:120px" /><col style="width:170px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminCarts,
  deleteOne: deleteAdminCart,
  getId: (c) => c.id,
  matchesQuery: (c, q) =>
    (c.userFullName ?? "").toLowerCase().includes(q) ||
    (c.userEmail ?? "").toLowerCase().includes(q) ||
    (c.isGuest && "гість".includes(q)),
  rowHtml: (c, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${c.id}">
      <td class="admin-table__user-cell" title="${escapeHtml(c.userFullName ?? "Гість")}">
        <span class="admin-table__user-name">${escapeHtml(c.userFullName ?? "Гість")}</span>
        ${c.userEmail ? `<span class="admin-table__subtext">${escapeHtml(c.userEmail)}</span>` : ""}
      </td>
      <td class="admin-table__description-cell">${c.itemsCount}</td>
      <td class="admin-table__description-cell">${formatDateTime(c.createdAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${c.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${c.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (c) => `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(
        (c.userFullName ?? "Г").trim().charAt(0).toUpperCase() || "?"
      )}</span>
      <div>
        <h2 class="admin-preview__name">${escapeHtml(c.userFullName ?? "Гість")}</h2>
      </div>
    </div>
    ${c.userEmail ? previewFieldHtml("email", "Email", escapeHtml(c.userEmail)) : ""}
    ${previewFieldHtml("hash", "Товарів у кошику", String(c.itemsCount))}
    ${previewFieldHtml("calendar", "Створено", formatDateTime(c.createdAt))}`,
  confirmTitle: () => "Видалити кошик?",
  confirmMessage: (c) =>
    `Кошик користувача «${c.userFullName ?? "Гість"}» разом з усіма товарами (${
      c.itemsCount
    }) буде видалено безповоротно.`,
});

const cartItemsTable = createSimpleAdminTable<ApiAdminCartItem>({
  title: "Предмети кошика",
  hint: "Товари, додані до кошиків покупців — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за товаром або власником кошика…",
  emptyHtml: `<div class="admin-categories-empty">Предметів кошика ще немає.</div>`,
  theadHtml: `<tr><th>Кошик</th><th>Товар</th><th>Кількість</th><th>Додано</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:110px" /><col style="width:170px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminCartItems,
  deleteOne: deleteAdminCartItem,
  getId: (i) => i.id,
  matchesQuery: (i, q) => i.cartOwner.toLowerCase().includes(q) || i.productName.toLowerCase().includes(q),
  rowHtml: (i, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${i.id}">
      <td class="admin-table__description-cell" title="${escapeHtml(i.cartOwner)}">${escapeHtml(i.cartOwner)}</td>
      <td class="admin-table__description-cell">${escapeHtml(i.productName)}</td>
      <td class="admin-table__description-cell">${i.quantity}</td>
      <td class="admin-table__description-cell">${formatDateTime(i.addedAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${i.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${i.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (i) => `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(i.productName)}</h2>
    </div>
    ${previewFieldHtml("tag", "Кошик", escapeHtml(i.cartOwner))}
    ${previewFieldHtml("hash", "Кількість", String(i.quantity))}
    ${previewFieldHtml("calendar", "Додано", formatDateTime(i.addedAt))}`,
  confirmTitle: () => "Видалити товар з кошика?",
  confirmMessage: (i) => `«${i.productName}» (${i.quantity} шт.) буде прибрано з кошика «${i.cartOwner}».`,
});

// Рецепти й теги продуктів — тільки перегляд (deleteOne/confirmTitle/
// confirmMessage не задані навмисно): редагується це лише через форму
// самого продукту (дивись openProductModal нижче), тут — суто
// довідковий список по всій БД одразу.
const productRecipesTable = createSimpleAdminTable<ApiAdminProductRecipeItem>({
  title: "Рецепти продуктів",
  hint: "Норми витрати інгредієнтів на продукт — редагується у формі самого продукту, тут лише перегляд.",
  searchPlaceholder: "Пошук за продуктом або інгредієнтом…",
  emptyHtml: `<div class="admin-categories-empty">Рецептів ще немає — додайте їх у формі продукту.</div>`,
  theadHtml: `<tr><th>Продукт</th><th>Інгредієнт</th><th>Кількість</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:140px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminProductRecipes,
  getId: (r) => r.id,
  matchesQuery: (r, q) => r.productName.toLowerCase().includes(q) || r.ingredientName.toLowerCase().includes(q),
  rowHtml: (r, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${r.id}">
      <td class="admin-table__description-cell" title="${escapeHtml(r.productName)}">${escapeHtml(r.productName)}</td>
      <td class="admin-table__description-cell">${escapeHtml(r.ingredientName)}</td>
      <td class="admin-table__description-cell">${formatQuantity(r.quantity)} ${escapeHtml(r.ingredientUnit)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${r.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (r) => `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(r.productName)}</h2>
    </div>
    ${previewFieldHtml("tag", "Інгредієнт", escapeHtml(r.ingredientName))}
    ${previewFieldHtml("hash", "Кількість", `${formatQuantity(r.quantity)} ${escapeHtml(r.ingredientUnit)}`)}`,
});

const productTagsTable = createSimpleAdminTable<ApiAdminProductTagItem>({
  title: "Теги продуктів",
  hint: "Зв'язки продуктів із тегами — редагується у формі самого продукту, тут лише перегляд.",
  searchPlaceholder: "Пошук за продуктом або тегом…",
  emptyHtml: `<div class="admin-categories-empty">Тегів на продуктах ще немає — додайте їх у формі продукту.</div>`,
  theadHtml: `<tr><th>Продукт</th><th>Тег</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminProductTags,
  getId: (t) => t.id,
  matchesQuery: (t, q) => t.productName.toLowerCase().includes(q) || t.tagName.toLowerCase().includes(q),
  rowHtml: (t, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${t.id}">
      <td class="admin-table__description-cell" title="${escapeHtml(t.productName)}">${escapeHtml(t.productName)}</td>
      <td class="admin-table__description-cell">${escapeHtml(t.tagName)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${t.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (t) => `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(t.productName)}</h2>
    </div>
    ${previewFieldHtml("tag", "Тег", escapeHtml(t.tagName))}`,
});

// ==============================
// Продукти — повний CRUD, найскладніша таблиця адмінки: крім своїх
// полів (категорія, ціна, харчова цінність...) форма редагує ще дві
// вкладені сутності прямо тут — рецепт (product_recipes) і теги
// (product_tags), той самий підхід, що прохав власник: "щоб можна було
// пов'язувати в меню редагування або додавання запису продукту", а не
// окремою формою.
// ==============================

let allProducts: ApiProduct[] = [];
let productSearchQuery = "";
let productPage = 1;
let previewProductId: number | null = null;
const PRODUCT_PAGE_SIZE = 8;

// Довідники для селектів у формі — категорія/теги/інгредієнти можуть
// знадобитись, навіть якщо адмін ще не відкривав відповідні таблиці,
// тож тягнемо їх окремо тут, а не покладаємось на allCategories/
// allTags/allIngredients з інших розділів (ті заповнюються лише коли
// відкрита ЇХНЯ таблиця).
let productFormCategories: ApiCategory[] = [];
let productFormTags: ApiTag[] = [];
let productFormIngredients: ApiIngredient[] = [];

type ProductModalMode = { type: "create" } | { type: "edit"; id: number };
let productModalMode: ProductModalMode = { type: "create" };
let productModalImageUrl: string | null = null;
let productModalTagIds = new Set<number>();

interface ProductRecipeRow {
  // Локальний лічильник для React-подібного key — потрібен, щоб рядки
  // з однаковим (ще не обраним) інгредієнтом не плутались при
  // видаленні/перерендері.
  rowKey: number;
  ingredientId: number | null;
  quantity: string;
}
let productModalRecipeRows: ProductRecipeRow[] = [];
let productModalRecipeRowSeq = 0;

function renderProductModalIconPreview(): void {
  const previewSlot = document.getElementById("admin-product-icon-preview");
  const clearBtn = document.getElementById("admin-product-icon-clear") as HTMLButtonElement | null;
  if (previewSlot) previewSlot.innerHTML = categoryIconPreviewHtml(productModalImageUrl);
  if (clearBtn) clearBtn.hidden = !productModalImageUrl;
}

function setupProductModalIconPicker(): void {
  const fileInput = document.getElementById("admin-product-icon-file") as HTMLInputElement | null;
  const status = document.getElementById("admin-product-icon-status");
  const clearBtn = document.getElementById("admin-product-icon-clear");
  if (!fileInput) return;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (status) status.textContent = "Завантаження…";

    void (async () => {
      const result = await uploadIcon(file, "products");
      fileInput.value = "";

      if (!result.ok) {
        if (status) status.textContent = result.error;
        return;
      }

      if (status) status.textContent = "";
      productModalImageUrl = result.url;
      renderProductModalIconPreview();
    })();
  });

  clearBtn?.addEventListener("click", () => {
    productModalImageUrl = null;
    if (status) status.textContent = "";
    renderProductModalIconPreview();
  });
}

// ---- Рецепт: динамічні рядки "інгредієнт + кількість" ----

function renderProductRecipeRows(): void {
  const wrap = document.getElementById("admin-product-recipe-rows");
  if (!wrap) return;

  if (!productModalRecipeRows.length) {
    wrap.innerHTML = "";
    return;
  }

  const options = productFormIngredients
    .map((ing) => `<option value="${ing.id}">${escapeHtml(ing.name)} (${escapeHtml(ing.unit)})</option>`)
    .join("");

  wrap.innerHTML = productModalRecipeRows
    .map(
      (row) => `
      <div class="admin-product-recipe-row" data-row-key="${row.rowKey}">
        <select data-recipe-ingredient>
          <option value="">— Оберіть інгредієнт —</option>
          ${options}
        </select>
        <input type="number" min="0" step="0.01" placeholder="К-сть" data-recipe-quantity value="${escapeHtml(
          row.quantity
        )}" />
        <button class="admin-product-recipe-row__remove" type="button" data-recipe-remove aria-label="Прибрати рядок">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>`
    )
    .join("");

  wrap.querySelectorAll<HTMLElement>("[data-row-key]").forEach((rowEl) => {
    const rowKey = Number(rowEl.dataset.rowKey);
    const row = productModalRecipeRows.find((r) => r.rowKey === rowKey);
    if (!row) return;

    const select = rowEl.querySelector<HTMLSelectElement>("[data-recipe-ingredient]");
    if (select) {
      select.value = row.ingredientId === null ? "" : String(row.ingredientId);
      select.addEventListener("change", () => {
        row.ingredientId = select.value ? Number(select.value) : null;
      });
    }

    const qtyInput = rowEl.querySelector<HTMLInputElement>("[data-recipe-quantity]");
    qtyInput?.addEventListener("input", () => {
      row.quantity = qtyInput.value;
    });

    rowEl.querySelector("[data-recipe-remove]")?.addEventListener("click", () => {
      productModalRecipeRows = productModalRecipeRows.filter((r) => r.rowKey !== rowKey);
      renderProductRecipeRows();
    });
  });
}

function addProductRecipeRow(): void {
  productModalRecipeRows.push({ rowKey: productModalRecipeRowSeq++, ingredientId: null, quantity: "" });
  renderProductRecipeRows();
}

// ---- Теги: чекбокси-пігулки ----

function renderProductTagsList(): void {
  const wrap = document.getElementById("admin-product-tags-list");
  if (!wrap) return;

  if (!productFormTags.length) {
    wrap.innerHTML = `<p class="admin-product-tags-empty">Тегів ще немає — додайте їх у розділі «Теги».</p>`;
    return;
  }

  wrap.innerHTML = productFormTags
    .map((tag) => {
      const checked = productModalTagIds.has(tag.id);
      const icon = tag.iconUrl
        ? `<img class="admin-product-tag-chip__icon" src="${tag.iconUrl}" alt="" aria-hidden="true" onerror="this.remove()" />`
        : "";
      return `
        <label class="admin-product-tag-chip${checked ? " admin-product-tag-chip--checked" : ""}" data-tag-chip="${
        tag.id
      }">
          <input type="checkbox" data-tag-checkbox value="${tag.id}" ${checked ? "checked" : ""} />
          ${icon}
          <span class="admin-product-tag-chip__label">${escapeHtml(tag.name)}</span>
        </label>`;
    })
    .join("");

  wrap.querySelectorAll<HTMLInputElement>("[data-tag-checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const tagId = Number(cb.value);
      if (cb.checked) productModalTagIds.add(tagId);
      else productModalTagIds.delete(tagId);
      cb.closest("[data-tag-chip]")?.classList.toggle("admin-product-tag-chip--checked", cb.checked);
    });
  });
}

function filteredProducts(): ApiProduct[] {
  const q = productSearchQuery.trim().toLowerCase();
  if (!q) return allProducts;
  return allProducts.filter((p) => p.name.toLowerCase().includes(q));
}

function categoryNameById(id: number): string {
  return productFormCategories.find((c) => c.id === id)?.name ?? allCategories.find((c) => c.id === id)?.name ?? "—";
}

function productPriceHtml(p: ApiProduct): string {
  if (p.discountPercent > 0) {
    const discounted = p.price * (1 - p.discountPercent / 100);
    return `${formatCurrency(discounted)} <span class="admin-table__subtext" style="text-decoration:line-through;text-decoration-color:var(--color-error);text-decoration-thickness:1.5px">${formatCurrency(
      p.price
    )}</span>`;
  }
  return formatCurrency(p.price);
}

function productRowHtml(p: ApiProduct): string {
  const icon = p.imageUrl
    ? `<img class="admin-table__icon skeleton" src="${p.imageUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${p.id === previewProductId ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
      <td class="admin-table__id-cell">${p.id}</td>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell admin-table__name-cell--flex" title="${escapeHtml(p.name)}">${escapeHtml(
    p.name
  )}</td>
      <td class="admin-table__description-cell">${escapeHtml(categoryNameById(p.categoryId))}</td>
      <td class="admin-table__description-cell">${productPriceHtml(p)}</td>
      <td class="admin-table__stock-cell">${p.stockQuantity} шт</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${p.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${p.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${p.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

const PRODUCT_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:56px" />
    <col />
    <col style="width:160px" />
    <col style="width:130px" />
    <col style="width:90px" />
    <col style="width:150px" />
  </colgroup>`;

const EMPTY_PRODUCTS_HTML = `<div class="admin-categories-empty">Продуктів ще немає — додайте перший нижче.</div>`;

function renderProductPagination(filteredCount: number): void {
  const el = document.getElementById("admin-products-pagination");
  if (!el) return;

  if (filteredCount === 0) {
    el.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / PRODUCT_PAGE_SIZE));
  const start = (productPage - 1) * PRODUCT_PAGE_SIZE + 1;
  const end = Math.min(productPage * PRODUCT_PAGE_SIZE, filteredCount);
  const summary = `<p class="admin-pagination__summary">Показано ${start}–${end} з ${pluralizeRecords(
    filteredCount
  )}</p>`;

  if (totalPages <= 1) {
    el.innerHTML = summary;
    return;
  }

  let pageButtons = "";
  for (let p = 1; p <= totalPages; p++) {
    pageButtons += `<button class="admin-pagination__page${
      p === productPage ? " admin-pagination__page--active" : ""
    }" data-page="${p}" type="button">${p}</button>`;
  }

  el.innerHTML = `
    ${summary}
    <div class="admin-pagination__controls">
      <button class="admin-pagination__arrow" id="admin-product-page-prev" type="button" aria-label="Попередня сторінка" ${
        productPage === 1 ? "disabled" : ""
      }>‹</button>
      ${pageButtons}
      <button class="admin-pagination__arrow" id="admin-product-page-next" type="button" aria-label="Наступна сторінка" ${
        productPage === totalPages ? "disabled" : ""
      }>›</button>
    </div>`;

  document.getElementById("admin-product-page-prev")?.addEventListener("click", () => {
    if (productPage > 1) {
      productPage--;
      renderProductsTableBody();
    }
  });
  document.getElementById("admin-product-page-next")?.addEventListener("click", () => {
    if (productPage < totalPages) {
      productPage++;
      renderProductsTableBody();
    }
  });
  el.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      productPage = Number(btn.dataset.page);
      renderProductsTableBody();
    });
  });
}

function productRecipeListHtml(p: ApiProduct): string {
  if (!p.recipes.length) return `<p class="admin-product-tags-empty">Рецепт не задано.</p>`;
  return `<ul class="admin-product-preview-recipe-list">${p.recipes
    .map((r: ApiProductRecipeItem) => `<li>${escapeHtml(r.ingredientName)} — ${formatQuantity(r.quantity)} ${escapeHtml(r.ingredientUnit)}</li>`)
    .join("")}</ul>`;
}

function productTagListHtml(p: ApiProduct): string {
  if (!p.tagIds.length) return `<p class="admin-product-tags-empty">Тегів немає.</p>`;
  const names = p.tagIds.map((id) => productFormTags.find((t) => t.id === id)?.name).filter(Boolean) as string[];
  if (!names.length) return `<p class="admin-product-tags-empty">Тегів немає.</p>`;
  return `<div class="admin-product-tags-list">${names
    .map((n) => `<span class="admin-product-tag-chip admin-product-tag-chip--checked">${escapeHtml(n)}</span>`)
    .join("")}</div>`;
}

function renderProductPreviewPanel(): void {
  const panel = document.getElementById("admin-product-preview");
  if (!panel) return;

  const product = allProducts.find((p) => p.id === previewProductId);
  if (!product) {
    panel.innerHTML = `<div class="admin-preview-empty">Оберіть продукт зі списку, щоб переглянути&nbsp;деталі.</div>`;
    return;
  }

  const icon = product.imageUrl
    ? `<img class="admin-preview__icon skeleton" src="${product.imageUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;

  panel.innerHTML = `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(product.name)}</h2>
      <span class="admin-preview__id">ID: ${product.id}</span>
    </div>
    ${icon}
    ${previewFieldHtml("tag", "Категорія", escapeHtml(categoryNameById(product.categoryId)))}
    ${previewFieldHtml("hash", "Ціна", productPriceHtml(product))}
    ${previewFieldHtml("hash", "Залишок", `${product.stockQuantity} шт`)}
    ${product.weight ? previewFieldHtml("hash", "Вага/об'єм", escapeHtml(product.weight)) : ""}
    ${
      product.description
        ? `<div class="admin-preview__field"><span class="admin-preview__field-label">Опис</span><p class="admin-preview__field-value">${escapeHtml(
            product.description
          )}</p></div>`
        : ""
    }
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Рецепт</span>
      ${productRecipeListHtml(product)}
    </div>
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Теги</span>
      ${productTagListHtml(product)}
    </div>

    <div class="admin-preview__actions">
      <button class="btn btn--ghost" id="admin-product-preview-edit-btn" type="button">Редагувати</button>
      <button class="btn btn--danger" id="admin-product-preview-delete-btn" type="button">Видалити</button>
    </div>`;
  animatePreviewPanelIn(panel);

  document.getElementById("admin-product-preview-edit-btn")?.addEventListener("click", () => {
    void openProductModal({ type: "edit", id: product.id });
  });

  document.getElementById("admin-product-preview-delete-btn")?.addEventListener("click", () => {
    void (async () => {
      const confirmed = await confirmDelete(
        "Видалити продукт?",
        `«${product.name}» буде видалено безповоротно, разом з рецептом і тегами.`
      );
      if (!confirmed) return;
      const result = await deleteProduct(product.id);
      if (!result.ok) {
        await showAdminAlert("Помилка", result.error);
        return;
      }
      previewProductId = null;
      await loadAndRenderProducts();
    })();
  });
}

function highlightActiveProductRow(): void {
  const wrap = document.getElementById("admin-products-table-wrap");
  if (!wrap) return;
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
    tr.classList.toggle("admin-table__row--active", Number(tr.dataset.rowId) === previewProductId);
  });
}

function renderProductsTableBody(): void {
  const wrap = document.getElementById("admin-products-table-wrap");
  if (!wrap) return;

  if (!allProducts.length) {
    wrap.innerHTML = EMPTY_PRODUCTS_HTML;
    renderProductPagination(0);
    return;
  }

  const filtered = filteredProducts();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCT_PAGE_SIZE));
  if (productPage > totalPages) productPage = totalPages;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="admin-categories-empty">Нічого не знайдено за запитом «${escapeHtml(
      productSearchQuery
    )}».</div>`;
    renderProductPagination(0);
    return;
  }

  const pageItems = filtered.slice(
    (productPage - 1) * PRODUCT_PAGE_SIZE,
    productPage * PRODUCT_PAGE_SIZE
  );
  const rowsHtml = pageItems.map(productRowHtml).join("");

  const existingTbody = wrap.querySelector<HTMLTableSectionElement>("tbody");
  if (existingTbody) {
    reconcileTableRows(existingTbody, rowsHtml);
  } else {
    wrap.innerHTML = `
      <table class="admin-table">
        ${PRODUCT_TABLE_COLGROUP}
        <thead>
          <tr>
            <th>ID</th>
            <th></th>
            <th>Назва</th>
            <th>Категорія</th>
            <th>Ціна</th>
            <th>Залишок</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  renderProductPagination(filtered.length);
}

function setupProductTableEvents(): void {
  const wrap = document.getElementById("admin-products-table-wrap");
  if (!wrap) return;

  const openPreview = (id: number): void => {
    previewProductId = id;
    highlightActiveProductRow();
    renderProductPreviewPanel();
  };

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
    if (previewBtn) {
      openPreview(Number(previewBtn.dataset.preview));
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      void openProductModal({ type: "edit", id: Number(editBtn.dataset.edit) });
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.delete);
      const product = allProducts.find((p) => p.id === id);
      if (!product) return;

      void (async () => {
        const confirmed = await confirmDelete(
          "Видалити продукт?",
          `«${product.name}» буде видалено безповоротно, разом з рецептом і тегами.`
        );
        if (!confirmed) return;
        const result = await deleteProduct(id);
        if (!result.ok) {
          await showAdminAlert("Помилка", result.error);
          return;
        }
        if (previewProductId === id) previewProductId = null;
        await loadAndRenderProducts();
      })();
      return;
    }

    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
      if (row) openPreview(Number(row.dataset.rowId));
    }
  });
}

async function loadAndRenderProducts(): Promise<void> {
  allProducts = await getProducts();
  if (previewProductId !== null && !allProducts.some((p) => p.id === previewProductId)) {
    previewProductId = null;
  }
  renderProductsTableBody();
  renderProductPreviewPanel();
}

function setupProductSearch(): void {
  const input = document.getElementById("admin-product-search") as HTMLInputElement | null;
  const clearBtn = document.getElementById("admin-product-search-clear") as HTMLButtonElement | null;
  if (!input) return;

  const syncClearBtn = (): void => {
    clearBtn?.classList.toggle("admin-search-clear--visible", input.value.length > 0);
  };

  input.addEventListener("input", () => {
    productSearchQuery = input.value;
    productPage = 1;
    syncClearBtn();
    renderProductsTableBody();
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    productSearchQuery = "";
    productPage = 1;
    syncClearBtn();
    renderProductsTableBody();
    input.focus();
  });

  syncClearBtn();
}

function onProductModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeProductModal();
}

function populateProductCategorySelect(): void {
  const select = document.getElementById("admin-product-category") as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = productFormCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
}

async function openProductModal(mode: ProductModalMode): Promise<void> {
  const modal = document.getElementById("admin-product-modal");
  const title = document.getElementById("admin-product-modal-title");
  const submitBtn = document.getElementById("admin-product-modal-submit");
  const message = document.getElementById("admin-product-message");
  const form = document.getElementById("admin-product-form") as HTMLFormElement | null;
  if (!modal || !form) return;

  // Довідники тягнемо щоразу під час відкриття — легка ціна (3 маленькі
  // GET), зате форма завжди бачить свіжі категорії/теги/інгредієнти,
  // навіть якщо їх щойно додали в іншій вкладці адмінки.
  [productFormCategories, productFormTags, productFormIngredients] = await Promise.all([
    getCategories(),
    getTags(),
    getIngredients(),
  ]);
  populateProductCategorySelect();

  productModalMode = mode;
  form.reset();
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }
  productModalImageUrl = null;
  productModalTagIds = new Set();
  productModalRecipeRows = [];
  productModalRecipeRowSeq = 0;

  if (mode.type === "edit") {
    const product = allProducts.find((p) => p.id === mode.id);
    if (!product) return;
    if (title) title.textContent = "Редагувати продукт";
    if (submitBtn) submitBtn.textContent = "Зберегти";

    (document.getElementById("admin-product-category") as HTMLSelectElement).value = String(product.categoryId);
    (document.getElementById("admin-product-name") as HTMLInputElement).value = product.name;
    (document.getElementById("admin-product-description") as HTMLTextAreaElement).value = product.description ?? "";
    (document.getElementById("admin-product-weight") as HTMLInputElement).value = product.weight ?? "";
    (document.getElementById("admin-product-shelf-life") as HTMLInputElement).value =
      product.shelfLifeDays === null ? "" : String(product.shelfLifeDays);
    (document.getElementById("admin-product-storage") as HTMLInputElement).value = product.storageConditions ?? "";
    (document.getElementById("admin-product-calories") as HTMLInputElement).value =
      product.calories === null ? "" : String(product.calories);
    (document.getElementById("admin-product-proteins") as HTMLInputElement).value =
      product.proteins === null ? "" : String(product.proteins);
    (document.getElementById("admin-product-fats") as HTMLInputElement).value =
      product.fats === null ? "" : String(product.fats);
    (document.getElementById("admin-product-carbs") as HTMLInputElement).value =
      product.carbohydrates === null ? "" : String(product.carbohydrates);
    (document.getElementById("admin-product-price") as HTMLInputElement).value = String(product.price);
    (document.getElementById("admin-product-discount") as HTMLInputElement).value = String(product.discountPercent);
    (document.getElementById("admin-product-stock") as HTMLInputElement).value = String(product.stockQuantity);

    productModalImageUrl = product.imageUrl;
    productModalTagIds = new Set(product.tagIds);
    productModalRecipeRows = product.recipes.map((r) => ({
      rowKey: productModalRecipeRowSeq++,
      ingredientId: r.ingredientId,
      quantity: String(r.quantity),
    }));
  } else {
    if (title) title.textContent = "Додати продукт";
    if (submitBtn) submitBtn.textContent = "Додати продукт";
    (document.getElementById("admin-product-discount") as HTMLInputElement).value = "0";
    (document.getElementById("admin-product-stock") as HTMLInputElement).value = "0";
  }

  renderProductModalIconPreview();
  renderProductRecipeRows();
  renderProductTagsList();

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onProductModalKeydown);
}

function closeProductModal(): void {
  const modal = document.getElementById("admin-product-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onProductModalKeydown);
  unlockScroll();
}

function setupProductModal(): void {
  const modal = document.getElementById("admin-product-modal");
  const closeBtn = document.getElementById("admin-product-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  const form = document.getElementById("admin-product-form") as HTMLFormElement | null;
  const message = document.getElementById("admin-product-message");
  const categoryError = document.getElementById("admin-product-category-error");
  const nameError = document.getElementById("admin-product-name-error");
  const priceError = document.getElementById("admin-product-price-error");
  if (!modal || !form) return;

  closeBtn?.addEventListener("click", closeProductModal);
  backdrop?.addEventListener("click", closeProductModal);
  setupProductModalIconPicker();

  document.getElementById("admin-product-recipe-add-btn")?.addEventListener("click", addProductRecipeRow);

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (categoryError) categoryError.textContent = "";
    if (nameError) nameError.textContent = "";
    if (priceError) priceError.textContent = "";

    const categoryId = Number((document.getElementById("admin-product-category") as HTMLSelectElement).value);
    const name = (document.getElementById("admin-product-name") as HTMLInputElement).value.trim();
    const price = (document.getElementById("admin-product-price") as HTMLInputElement).value;

    if (!name || name.length < 2) {
      if (nameError) nameError.textContent = "Введіть назву продукту (мінімум 2 символи)";
      return;
    }
    if (!price || Number(price) <= 0) {
      if (priceError) priceError.textContent = "Ціна має бути додатним числом";
      return;
    }

    const numOrNull = (id: string): number | null => {
      const v = (document.getElementById(id) as HTMLInputElement).value;
      return v === "" ? null : Number(v);
    };

    // Рядки рецепту без обраного інгредієнта чи без кількості просто
    // ігноруються (незаповнений рядок — не помилка, а "ще не готовий").
    const recipes = productModalRecipeRows
      .filter((r) => r.ingredientId !== null && r.quantity.trim() !== "" && Number(r.quantity) > 0)
      .map((r) => ({ ingredientId: r.ingredientId as number, quantity: Number(r.quantity) }));

    void (async () => {
      const input = {
        categoryId,
        name,
        description: (document.getElementById("admin-product-description") as HTMLTextAreaElement).value.trim(),
        weight: (document.getElementById("admin-product-weight") as HTMLInputElement).value.trim(),
        shelfLifeDays: numOrNull("admin-product-shelf-life"),
        storageConditions: (document.getElementById("admin-product-storage") as HTMLInputElement).value.trim(),
        calories: numOrNull("admin-product-calories"),
        proteins: numOrNull("admin-product-proteins"),
        fats: numOrNull("admin-product-fats"),
        carbohydrates: numOrNull("admin-product-carbs"),
        price: Number(price),
        discountPercent: Number((document.getElementById("admin-product-discount") as HTMLInputElement).value || 0),
        imageUrl: productModalImageUrl ?? "",
        stockQuantity: Number((document.getElementById("admin-product-stock") as HTMLInputElement).value || 0),
        recipes,
        tagIds: [...productModalTagIds],
      };

      const result =
        productModalMode.type === "edit"
          ? await updateProduct(productModalMode.id, input)
          : await createProduct(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeProductModal();
      await loadAndRenderProducts();
    })();
  });
}

function renderProductsTable(): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  productSearchQuery = "";
  productPage = 1;
  previewProductId = null;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">Продукти</h1>

    <div class="admin-categories-layout">
      <section class="admin-section admin-section--wide">
        <div class="admin-section__header">
          <p class="admin-section__hint">Тут знаходиться каталог продукції, який включає в себе випічку та інші товари.</p>
          <button class="btn btn--primary-sm admin-add-btn" id="admin-product-add-btn" type="button">+ Додати продукт</button>
        </div>

        <div class="admin-table-toolbar">
          <div class="admin-search-wrap">
            <input type="text" id="admin-product-search" class="admin-table-search" placeholder="Пошук за назвою…" autocomplete="off" />
            <button class="admin-search-clear" id="admin-product-search-clear" type="button" aria-label="Очистити пошук">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div id="admin-products-table-wrap" class="admin-table-wrap"></div>
        <div id="admin-products-pagination" class="admin-pagination"></div>
      </section>

      <section class="admin-section admin-preview" id="admin-product-preview"></section>
    </div>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-product-add-btn")?.addEventListener("click", () => {
    void openProductModal({ type: "create" });
  });

  setupProductSearch();
  setupProductTableEvents();
  // Довідники (категорії/теги) потрібні преview-панелі для назв — тож
  // тягнемо їх одразу тут, а не лише в момент відкриття модалки.
  void (async () => {
    [productFormCategories, productFormTags] = await Promise.all([getCategories(), getTags()]);
    await loadAndRenderProducts();
  })();
}

async function renderTableView(key: string): Promise<void> {
  const table = TABLES.find((t) => t.key === key);
  if (!table) {
    window.location.hash = "";
    return;
  }

  if (table.key === "categories") {
    renderCategoriesTable();
  } else if (table.key === "tags") {
    renderTagsTable();
  } else if (table.key === "user_tag_preferences") {
    renderUserPreferencesTable();
  } else if (table.key === "users") {
    renderUsersTable();
  } else if (table.key === "sessions") {
    renderSessionsTable();
  } else if (table.key === "ingredients") {
    renderIngredientsTable();
  } else if (table.key === "payment_methods") {
    renderPaymentMethodsTable();
  } else if (table.key === "wishlists") {
    wishlistsTable.render();
  } else if (table.key === "carts") {
    cartsTable.render();
  } else if (table.key === "cart_items") {
    cartItemsTable.render();
  } else if (table.key === "product_recipes") {
    productRecipesTable.render();
  } else if (table.key === "product_tags") {
    productTagsTable.render();
  } else if (table.key === "products") {
    renderProductsTable();
  } else {
    renderStub(table.label);
  }
}

// ==============================
// Модалка підтвердження видалення — та сама розмітка/класи, що й
// "Очистити кошик?" на index.html (auth-modal.css), просто своя копія
// в admin.html. Відкриття/закриття тут без прив'язки до конкретної дії
// — резолвиться через Promise<boolean>, підходить для будь-якого рядка.
// ==============================

function confirmDelete(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById("admin-delete-modal");
    const titleEl = document.getElementById("admin-delete-modal-title");
    const text = document.getElementById("admin-delete-modal-text");
    const cancelBtn = document.getElementById("admin-delete-modal-cancel");
    const confirmBtn = document.getElementById("admin-delete-modal-confirm");
    const closeBtn = document.getElementById("admin-delete-modal-close");
    const backdrop = modal?.querySelector(".auth-modal__backdrop");
    if (!modal || !cancelBtn || !confirmBtn || !closeBtn) {
      resolve(window.confirm(message));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (text) text.textContent = message;

    const close = (result: boolean): void => {
      modal.classList.remove("auth-modal--open");
      modal.setAttribute("aria-hidden", "true");
      unlockScroll();
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      closeBtn.removeEventListener("click", onCancel);
      backdrop?.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onCancel = (): void => close(false);
    const onConfirm = (): void => close(true);

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
    closeBtn.addEventListener("click", onCancel);
    backdrop?.addEventListener("click", onCancel);

    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("auth-modal--open");
    lockScroll();
  });
}

// Той самий попап, що confirmDelete() вище, тільки з однією кнопкою —
// для повідомлень про помилку (наприклад "не можна видалити, бо
// використовується деінде"), замість браузерного window.alert(), який
// візуально випадає зі стилю решти адмінки.
function showAdminAlert(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    const modal = document.getElementById("admin-alert-modal");
    const titleEl = document.getElementById("admin-alert-modal-title");
    const text = document.getElementById("admin-alert-modal-text");
    const okBtn = document.getElementById("admin-alert-modal-ok");
    const closeBtn = document.getElementById("admin-alert-modal-close");
    const backdrop = modal?.querySelector(".auth-modal__backdrop");
    if (!modal || !okBtn || !closeBtn) {
      window.alert(message);
      resolve();
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (text) text.textContent = message;

    const close = (): void => {
      modal.classList.remove("auth-modal--open");
      modal.setAttribute("aria-hidden", "true");
      unlockScroll();
      okBtn.removeEventListener("click", onClose);
      closeBtn.removeEventListener("click", onClose);
      backdrop?.removeEventListener("click", onClose);
      resolve();
    };
    const onClose = (): void => close();

    okBtn.addEventListener("click", onClose);
    closeBtn.addEventListener("click", onClose);
    backdrop?.addEventListener("click", onClose);

    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("auth-modal--open");
    lockScroll();
  });
}

// ==============================
// Топбар/меню (спільне з index.html) + захист сторінки сесією.
// ==============================

async function render(): Promise<void> {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;

  const session = await getSession();

  if (!session || session.role !== "admin") {
    window.location.href = "index.html";
    return;
  }

  slot.innerHTML = userMenuHtml(session);

  document.getElementById("logout-btn")?.addEventListener("click", () => {
    void (async () => {
      await logout();
      window.location.href = "index.html";
    })();
  });

  setupUserMenu();
  setupCategoryModal();
  setupTagModal();
  setupPrefModal();
  setupUserModal();
  setupIngredientModal();
  setupProductModal();
  setupSidebar();

  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

initPreloader();

document.addEventListener("DOMContentLoaded", () => {
  void (async () => {
    try {
      await render();
    } finally {
      hidePreloader();
    }
  })();
});

