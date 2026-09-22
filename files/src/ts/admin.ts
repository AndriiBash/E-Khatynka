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
  getIngredientMovements,
  createIngredientMovement,
  deleteIngredientMovement,
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
  getAdminOrders,
  deleteAdminOrder,
  updateAdminOrderStatus,
  getAdminOrderItems,
  deleteAdminOrderItem,
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
  ApiAdminIngredientMovement,
  ApiAdminPaymentMethod,
  ApiProduct,
  ApiProductRecipeItem,
  ApiAdminWishlistItem,
  ApiAdminCart,
  ApiAdminCartItem,
  ApiAdminProductRecipeItem,
  ApiAdminProductTagItem,
  ApiAdminOrder,
  ApiAdminOrderItem,
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

// Список сторінок для пагінації, з "…" на пропущені проміжки — завжди
// перша й остання сторінка, плюс сусід зліва/справа від поточної.
// Наприклад для current=5, total=42: [1, "…", 4, 5, 6, "…", 42].
// Використовується у createSimpleAdminTable нижче — один спільний
// рендер пагінації на всі 15 таблиць адмінки.
function paginationPageList(current: number, total: number): (number | "…")[] {
  const delta = 1;
  const pages: number[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      pages.push(i);
    }
  }
  const result: (number | "…")[] = [];
  let prev = 0;
  for (const p of pages) {
    if (prev && p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
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

// Іконка модалки додавання/редагування — єдине джерело правди для
// поточного вибору файлу (сам файл уже залито на сервер одразу при
// виборі, тут лишається тільки готовий url).
let categoryModalIconUrl: string | null = null;
// edit несе сам об'єкт (а не лише id) — його дає onEdit фабрики нижче,
// шукати в якомусь локальному списку більше не треба.
type CategoryModalMode = { type: "create" } | { type: "edit"; category: ApiCategory };
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

function categoryRowHtml(c: ApiCategory, isActive: boolean): string {
  const icon = c.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${c.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;
  const description = c.description ? escapeHtml(c.description) : "—";

  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${c.id}">
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

// Спільний <colgroup>/<thead> — визначає ширину колонок
// (table-layout: fixed), передається у фабрику нижче як
// colgroupHtml/theadHtml.
const CATEGORY_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:48px" />
    <col style="width:44px" />
    <col style="width:130px" />
    <col />
    <col style="width:150px" />
  </colgroup>`;
const CATEGORY_TABLE_THEAD = `
  <tr>
    <th>ID</th>
    <th></th>
    <th>Назва</th>
    <th>Опис</th>
    <th></th>
  </tr>`;

const EMPTY_CATEGORIES_HTML = `
  <div class="admin-categories-empty">
    <img class="admin-categories-empty__icon" src="assets/images/empty-categories.png" alt="" aria-hidden="true" onerror="this.style.display='none'" />
    Категорій ще немає.<br />Додайте першу кнопкою вище.
  </div>`;


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
    const category = mode.category;
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
          ? await updateCategory(categoryModalMode.category.id, input)
          : await createCategory(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeCategoryModal();
      await categoriesTable.refresh();
    })();
  });
}

const categoriesTable = createSimpleAdminTable<ApiCategory>({
  title: "Категорії",
  hint: "Категорії, які ви тут додаєте, одразу зʼявляються у боковому меню каталогу для покупця.",
  searchPlaceholder: "Пошук категорій за назвою…",
  emptyHtml: EMPTY_CATEGORIES_HTML,
  theadHtml: CATEGORY_TABLE_THEAD,
  colgroupHtml: CATEGORY_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getCategories,
  getId: (c) => c.id,
  matchesQuery: (c, q) => c.name.toLowerCase().includes(q),
  rowHtml: categoryRowHtml,
  previewBodyHtml: (category) => {
    const icon = category.iconUrl
      ? `<img class="admin-preview__icon skeleton" src="${category.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
      : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;
    return `
      <div class="admin-preview__header">
        <h2 class="admin-preview__name">${escapeHtml(category.name)}</h2>
        <span class="admin-preview__id">ID: ${category.id}</span>
      </div>
      ${icon}
      <div class="admin-preview__field">
        <span class="admin-preview__field-label">Опис</span>
        <p class="admin-preview__field-value">${category.description ? escapeHtml(category.description) : "—"}</p>
      </div>`;
  },
  confirmTitle: () => "Видалити категорію?",
  confirmMessage: (c) => `Категорію «${c.name}» буде видалено безповоротно.`,
  deleteOne: deleteCategory,
  onEdit: (category) => openCategoryModal({ type: "edit", category }),
  addButtonLabel: "+ Додати категорію",
  onAdd: () => openCategoryModal({ type: "create" }),
});

// ==============================
// Теги — той самий CRUD-патерн, що й категорії, лише без опису (за
// ER-діаграмою в тегів тільки name + icon_url).
// ==============================

let tagModalIconUrl: string | null = null;
type TagModalMode = { type: "create" } | { type: "edit"; tag: ApiTag };
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

function tagRowHtml(t: ApiTag, isActive: boolean): string {
  const icon = t.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${t.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${t.id}">
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
const TAG_TABLE_THEAD = `
  <tr>
    <th>ID</th>
    <th></th>
    <th>Назва</th>
    <th></th>
  </tr>`;

const EMPTY_TAGS_HTML = `
  <div class="admin-categories-empty">Тегів ще немає.<br />Додайте перший кнопкою вище.</div>`;


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
    const tag = mode.tag;
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
      const result =
        tagModalMode.type === "edit" ? await updateTag(tagModalMode.tag.id, input) : await createTag(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeTagModal();
      await tagsTable.refresh();
    })();
  });
}

const tagsTable = createSimpleAdminTable<ApiTag>({
  title: "Теги",
  hint: 'Теги можна прикріпити до продуктів (розділ "Теги продуктів") і показати покупцю як позначки на картці.',
  searchPlaceholder: "Пошук тегів за назвою…",
  emptyHtml: EMPTY_TAGS_HTML,
  theadHtml: TAG_TABLE_THEAD,
  colgroupHtml: TAG_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getTags,
  getId: (t) => t.id,
  matchesQuery: (t, q) => t.name.toLowerCase().includes(q),
  rowHtml: tagRowHtml,
  previewBodyHtml: (tag) => {
    const icon = tag.iconUrl
      ? `<img class="admin-preview__icon skeleton" src="${tag.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
      : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;
    return `
      <div class="admin-preview__header">
        <h2 class="admin-preview__name">${escapeHtml(tag.name)}</h2>
        <span class="admin-preview__id">ID: ${tag.id}</span>
      </div>
      ${icon}`;
  },
  confirmTitle: () => "Видалити тег?",
  confirmMessage: (t) => `Тег «${t.name}» буде видалено безповоротно.`,
  deleteOne: deleteTag,
  onEdit: (tag) => openTagModal({ type: "edit", tag }),
  addButtonLabel: "+ Додати тег",
  onAdd: () => openTagModal({ type: "create" }),
});

// ==============================
// Вподобання користувачів (user_tag_preferences) — простіший список:
// без окремої панелі перегляду (уся інформація вже в самому рядку),
// додавання — вибором користувача й тегу з випадних списків.
// ==============================

type PrefModalMode = { type: "create" } | { type: "edit"; pref: ApiUserTagPreference };
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

function prefRowHtml(p: ApiUserTagPreference, isActive: boolean): string {
  const icon = p.tagIconUrl
    ? `<img class="admin-table__icon skeleton" src="${p.tagIconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
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
const PREF_TABLE_THEAD = `
  <tr>
    <th>ID</th>
    <th>Користувач</th>
    <th></th>
    <th>Тег</th>
    <th>Додано</th>
    <th></th>
  </tr>`;

const EMPTY_PREFS_HTML = `
  <div class="admin-categories-empty">Вподобань ще немає.<br />Додайте перше кнопкою вище.</div>`;

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

  const editingPref = mode.type === "edit" ? mode.pref : null;
  if (title) title.textContent = mode.type === "edit" ? "Редагувати вподобання" : "Додати вподобання";
  if (submitBtn) submitBtn.textContent = mode.type === "edit" ? "Зберегти" : "Додати вподобання";

  userSelect.innerHTML = `<option value="">Завантаження…</option>`;
  tagSelect.innerHTML = `<option value="">Завантаження…</option>`;

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onPrefModalKeydown);

  const [users, tags] = await Promise.all([getAdminUsers(), getTags()]);

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
          ? await updateUserTagPreference(prefModalMode.pref.id, { userId, tagId })
          : await createUserTagPreference({ userId, tagId });

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      closePrefModal();
      await prefsTable.refresh();
    })();
  });
}

const prefsTable = createSimpleAdminTable<ApiUserTagPreference>({
  title: "Вподобання користувачів",
  hint: "Тут — теги, продукти з якими користувач ХОЧЕ бачити в каталозі й рекомендаціях.",
  searchPlaceholder: "Пошук за користувачем або тегом…",
  emptyHtml: EMPTY_PREFS_HTML,
  theadHtml: PREF_TABLE_THEAD,
  colgroupHtml: PREF_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getUserTagPreferences,
  getId: (p) => p.id,
  matchesQuery: (p, q) => p.userFullName.toLowerCase().includes(q) || p.tagName.toLowerCase().includes(q),
  rowHtml: prefRowHtml,
  previewBodyHtml: (pref) => {
    const icon = pref.tagIconUrl
      ? `<img class="admin-preview__icon skeleton" src="${pref.tagIconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
      : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;
    return `
      <div class="admin-preview__header">
        <h2 class="admin-preview__name">${escapeHtml(pref.tagName)}</h2>
        <span class="admin-preview__id">ID: ${pref.id}</span>
      </div>
      ${icon}
      ${previewFieldHtml("user", "Користувач", escapeHtml(pref.userFullName))}
      ${previewFieldHtml("email", "Email", escapeHtml(pref.userEmail))}
      ${previewFieldHtml("tag", "Тег", escapeHtml(pref.tagName))}
      ${previewFieldHtml("calendar", "Додано", formatDateTime(pref.createdAt))}`;
  },
  confirmTitle: () => "Видалити вподобання?",
  confirmMessage: (p) => `Вподобання «${p.userFullName} → ${p.tagName}» буде видалено безповоротно.`,
  deleteOne: deleteUserTagPreference,
  onEdit: (pref) => void openPrefModal({ type: "edit", pref }),
  addButtonLabel: "+ Додати вподобання",
  onAdd: () => void openPrefModal({ type: "create" }),
});

// ==============================
// "Користувачі" — лише перегляд + видалення (без модалки додавання:
// користувачі реєструються самі через форму на сайті, адмінка тут не
// створює акаунти вручну, як категорії/теги).
// ==============================

function formatCurrency(amount: number): string {
  return `${Math.round(amount).toLocaleString("uk-UA")} ₴`;
}

function userRoleBadgeHtml(role: string): string {
  const isAdmin = role === "admin";
  return `<span class="admin-table__badge${isAdmin ? " admin-table__badge--accent" : ""}">${
    isAdmin ? "Адміністратор" : "Покупець"
  }</span>`;
}

function userRowHtml(u: ApiAdminUser, isActive: boolean): string {
  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${escapeHtml(u.id)}">
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

const USER_TABLE_COLGROUP = `
  <colgroup>
    <col />
    <col style="width:125px" />
    <col style="width:150px" />
    <col style="width:110px" />
    <col style="width:150px" />
  </colgroup>`;
const USER_TABLE_THEAD = `
  <tr>
    <th>Користувач</th>
    <th>Телефон</th>
    <th>Роль</th>
    <th>Дата реєстрації</th>
    <th></th>
  </tr>`;

const EMPTY_USERS_HTML = `<div class="admin-categories-empty">Користувачів ще немає.</div>`;

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
  price: "admin-preview-price.svg",
  stock: "admin-preview-stock.svg",
  weight: "admin-preview-weight.svg",
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

function openUserModal(user: ApiAdminUser): void {
  const modal = document.getElementById("admin-user-modal");
  const nameInput = document.getElementById("admin-user-name") as HTMLInputElement | null;
  const phoneInput = document.getElementById("admin-user-phone") as HTMLInputElement | null;
  const emailHint = document.getElementById("admin-user-email-hint");
  const nameError = document.getElementById("admin-user-name-error");
  const phoneError = document.getElementById("admin-user-phone-error");
  const message = document.getElementById("admin-user-message");
  if (!modal || !nameInput || !phoneInput) return;

  userModalId = user.id;

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
      await usersTable.refresh();
    })();
  });
}

const usersTable = createSimpleAdminTable<ApiAdminUser, string>({
  title: "Користувачі",
  hint: "Зареєстровані користувачі системи — покупці й адміністратори.",
  searchPlaceholder: "Пошук за ім'ям, email або телефоном…",
  emptyHtml: EMPTY_USERS_HTML,
  theadHtml: USER_TABLE_THEAD,
  colgroupHtml: USER_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getAdminUsers,
  getId: (u) => u.id,
  parseId: (raw) => raw,
  matchesQuery: (u, q) =>
    u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.phone.toLowerCase().includes(q),
  rowHtml: userRowHtml,
  previewBodyHtml: (user) => `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(user.fullName)}</h2>
      ${userRoleBadgeHtml(user.role)}
    </div>
    ${previewFieldHtml("email", "Email", escapeHtml(user.email))}
    ${previewFieldHtml("phone", "Телефон", escapeHtml(user.phone))}
    ${previewFieldHtml("calendar", "Дата реєстрації", formatDateTime(user.createdAt))}
    ${previewFieldHtml("orders", "Замовлень", String(user.orderCount))}
    ${previewFieldHtml("wallet", "Сума покупок", formatCurrency(user.totalSpent))}`,
  confirmTitle: () => "Видалити користувача?",
  confirmMessage: (u) => `Користувача «${u.fullName}» буде видалено безповоротно.`,
  deleteOne: deleteAdminUser,
  onEdit: (user) => openUserModal(user),
});

// ==============================
// "Сесії" — лише перегляд + примусове завершення сесії (видалення
// рядка). Так само без модалки додавання — сесія створюється сама при
// вході, вручну тут нічого не заводять.
// ==============================

function sessionStatusBadgeHtml(expiresAt: number): string {
  const active = expiresAt > Date.now();
  return `<span class="admin-table__badge${active ? " admin-table__badge--success" : ""}">${
    active ? "Активна" : "Завершена"
  }</span>`;
}

function sessionRowHtml(s: ApiAdminSession, isActive: boolean): string {
  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${escapeHtml(s.token)}">
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

const SESSION_TABLE_COLGROUP = `
  <colgroup>
    <col />
    <col style="width:120px" />
    <col style="width:120px" />
    <col style="width:120px" />
    <col style="width:110px" />
  </colgroup>`;
const SESSION_TABLE_THEAD = `
  <tr>
    <th>Користувач</th>
    <th>Створено</th>
    <th>Діє до</th>
    <th>Статус</th>
    <th></th>
  </tr>`;

const EMPTY_SESSIONS_HTML = `<div class="admin-categories-empty">Активних сесій ще немає.</div>`;

const sessionsTable = createSimpleAdminTable<ApiAdminSession, string>({
  title: "Сесії",
  hint: "Активні й завершені сесії користувачів — можна примусово завершити будь-яку.",
  searchPlaceholder: "Пошук за користувачем або email…",
  emptyHtml: EMPTY_SESSIONS_HTML,
  theadHtml: SESSION_TABLE_THEAD,
  colgroupHtml: SESSION_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getAdminSessions,
  getId: (s) => s.token,
  parseId: (raw) => raw,
  matchesQuery: (s, q) => s.userFullName.toLowerCase().includes(q) || s.userEmail.toLowerCase().includes(q),
  rowHtml: sessionRowHtml,
  previewBodyHtml: (session) => `
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
    ${previewFieldHtml("shield", "Статус", sessionStatusBadgeHtml(session.expiresAt))}`,
  confirmTitle: () => "Завершити сесію?",
  confirmMessage: (s) => `Сесію користувача «${s.userFullName}» буде завершено — йому доведеться увійти знову.`,
  deleteButtonLabel: "Завершити сесію",
  deleteOne: deleteAdminSession,
  // Якщо адмін завершив ВЛАСНУ поточну сесію — це фактичний логаут,
  // кидаємо на index.html; якщо чужу — просто оновлюємо список
  // (reload — той самий loadAndRender фабрики).
  afterDelete: async (_session, reload) => {
    const stillLoggedIn = await getSession();
    if (!stillLoggedIn) {
      window.location.href = "index.html";
      return;
    }
    await reload();
  },
});

// ==============================
// Інгредієнти (склад) — повний CRUD: список + панель перегляду
// праворуч + модалка додавання/редагування (той самий підхід, що й у
// тегів, тільки замість іконки — числові поля "одиниця виміру",
// "залишок на складі", "поріг низького залишку").
// ==============================

type IngredientModalMode = { type: "create" } | { type: "edit"; ingredient: ApiIngredient };
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

function ingredientRowHtml(i: ApiIngredient, isActive: boolean): string {
  const icon = i.iconUrl
    ? `<img class="admin-table__icon skeleton" src="${i.iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${i.id}">
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
const INGREDIENT_TABLE_THEAD = `
  <tr>
    <th>ID</th>
    <th></th>
    <th>Назва</th>
    <th>Залишок</th>
    <th></th>
  </tr>`;

const EMPTY_INGREDIENTS_HTML = `
  <div class="admin-categories-empty">Інгредієнтів ще немає.<br />Додайте перший кнопкою вище.</div>`;


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
    const ingredient = mode.ingredient;
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
          ? await updateIngredient(ingredientModalMode.ingredient.id, input)
          : await createIngredient(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }
      closeIngredientModal();
      await ingredientsTable.refresh();
    })();
  });
}

const ingredientsTable = createSimpleAdminTable<ApiIngredient>({
  title: "Інгредієнти",
  hint: "Сировина на складі — облік залишків для виробництва продуктів.",
  searchPlaceholder: "Пошук інгредієнтів за назвою…",
  emptyHtml: EMPTY_INGREDIENTS_HTML,
  theadHtml: INGREDIENT_TABLE_THEAD,
  colgroupHtml: INGREDIENT_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getIngredients,
  getId: (i) => i.id,
  matchesQuery: (i, q) => i.name.toLowerCase().includes(q),
  rowHtml: ingredientRowHtml,
  previewBodyHtml: (ingredient) => {
    const icon = ingredient.iconUrl
      ? `<img class="admin-preview__icon skeleton" src="${ingredient.iconUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
      : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;
    return `
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
      )}`;
  },
  confirmTitle: () => "Видалити інгредієнт?",
  confirmMessage: (i) => `Інгредієнт «${i.name}» буде видалено безповоротно.`,
  deleteOne: deleteIngredient,
  onEdit: (ingredient) => openIngredientModal({ type: "edit", ingredient }),
  addButtonLabel: "+ Додати інгредієнт",
  onAdd: () => openIngredientModal({ type: "create" }),
});

// ==============================
// Рух інгредієнтів — журнал фактичних списань/надходжень (на відміну
// від product_recipes — там лише НОРМА витрати). Без редагування:
// помилковий запис видаляється (сервер поверне залишок назад) і
// додається новий, а не правиться заднім числом.
// ==============================

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  restock: "Поповнення",
  production: "Списано на виробництво",
  waste: "Списання браку",
  adjustment: "Ручне коригування",
};

function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type;
}

function movementQuantityHtml(m: ApiAdminIngredientMovement): string {
  const positive = m.quantity > 0;
  const sign = positive ? "+" : "";
  return `<span class="admin-table__badge${
    positive ? " admin-table__badge--success" : " admin-table__badge--warning"
  }">${sign}${formatQuantity(m.quantity)} ${escapeHtml(m.ingredientUnit)}</span>`;
}

function movementRowHtml(m: ApiAdminIngredientMovement, isActive: boolean): string {
  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${m.id}">
      <td class="admin-table__description-cell">${formatDateTimeShort(m.createdAt)}</td>
      <td class="admin-table__name-cell" title="${escapeHtml(m.ingredientName)}">${escapeHtml(m.ingredientName)}</td>
      <td class="admin-table__description-cell">${escapeHtml(movementTypeLabel(m.movementType))}</td>
      <td class="admin-table__description-cell">${movementQuantityHtml(m)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${m.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${m.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`;
}

const MOVEMENT_TABLE_COLGROUP = `
  <colgroup>
    <col style="width:130px" />
    <col />
    <col style="width:190px" />
    <col style="width:140px" />
    <col style="width:110px" />
  </colgroup>`;
const MOVEMENT_TABLE_THEAD = `
  <tr>
    <th>Дата</th>
    <th>Інгредієнт</th>
    <th>Тип руху</th>
    <th>Кількість</th>
    <th></th>
  </tr>`;

const EMPTY_MOVEMENTS_HTML = `<div class="admin-categories-empty">Рухів по складу ще немає.<br />Додайте перший кнопкою вище.</div>`;

// Довідники для селектів модалки — тягнемо при кожному відкритті (не
// кешуємо між відкриттями: список інгредієнтів/продуктів міг змінитись).
let movementFormIngredients: ApiIngredient[] = [];
let movementFormProducts: ApiProduct[] = [];

function onMovementModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeMovementModal();
}

async function openMovementModal(): Promise<void> {
  const modal = document.getElementById("admin-movement-modal");
  const ingredientSelect = document.getElementById("admin-movement-ingredient") as HTMLSelectElement | null;
  const productSelect = document.getElementById("admin-movement-product") as HTMLSelectElement | null;
  const typeSelect = document.getElementById("admin-movement-type") as HTMLSelectElement | null;
  const quantityInput = document.getElementById("admin-movement-quantity") as HTMLInputElement | null;
  const commentInput = document.getElementById("admin-movement-comment") as HTMLInputElement | null;
  const message = document.getElementById("admin-movement-message");
  if (!modal || !ingredientSelect || !productSelect || !typeSelect || !quantityInput) return;

  if (typeSelect) typeSelect.value = "restock";
  if (quantityInput) quantityInput.value = "";
  if (commentInput) commentInput.value = "";
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }
  ingredientSelect.innerHTML = `<option value="">Завантаження…</option>`;
  productSelect.innerHTML = `<option value="">Завантаження…</option>`;

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onMovementModalKeydown);

  [movementFormIngredients, movementFormProducts] = await Promise.all([getIngredients(), getProducts()]);

  ingredientSelect.innerHTML =
    `<option value="">— Оберіть інгредієнт —</option>` +
    movementFormIngredients
      .map((i) => `<option value="${i.id}">${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`)
      .join("");
  productSelect.innerHTML =
    `<option value="">— Не пов'язано з продуктом —</option>` +
    movementFormProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

function closeMovementModal(): void {
  const modal = document.getElementById("admin-movement-modal");
  if (!modal) return;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onMovementModalKeydown);
  unlockScroll();
}

function setupMovementModal(): void {
  const modal = document.getElementById("admin-movement-modal");
  const closeBtn = document.getElementById("admin-movement-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  const form = document.getElementById("admin-movement-form") as HTMLFormElement | null;
  const message = document.getElementById("admin-movement-message");
  const ingredientError = document.getElementById("admin-movement-ingredient-error");
  const quantityError = document.getElementById("admin-movement-quantity-error");
  const typeSelect = document.getElementById("admin-movement-type") as HTMLSelectElement | null;
  const quantityLabel = document.getElementById("admin-movement-quantity-label");
  const quantityInput = document.getElementById("admin-movement-quantity") as HTMLInputElement | null;
  if (!modal || !form) return;

  closeBtn?.addEventListener("click", closeMovementModal);
  backdrop?.addEventListener("click", closeMovementModal);

  if (quantityInput) restrictToNumericInput(quantityInput, true, true);

  // Для "Ручне коригування" кількість може бути й від'ємною (списати
  // частину без прив'язки до виробництва/браку) — підказка в лейблі
  // міняється разом з типом, щоб не плутати адміна знаком.
  typeSelect?.addEventListener("change", () => {
    if (!quantityLabel) return;
    quantityLabel.textContent =
      typeSelect.value === "adjustment" ? "Кількість (можна від'ємну — списати)" : "Кількість";
  });

  const showMessage = (text: string, isError: boolean): void => {
    if (!message) return;
    message.textContent = text;
    message.classList.add("form-message--visible");
    message.classList.toggle("form-message--error", isError);
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (ingredientError) ingredientError.textContent = "";
    if (quantityError) quantityError.textContent = "";

    const ingredientId = Number(
      (document.getElementById("admin-movement-ingredient") as HTMLSelectElement).value
    );
    const productIdRaw = (document.getElementById("admin-movement-product") as HTMLSelectElement).value;
    const movementType = (document.getElementById("admin-movement-type") as HTMLSelectElement).value;
    const quantityRaw = (document.getElementById("admin-movement-quantity") as HTMLInputElement).value;
    const comment = (document.getElementById("admin-movement-comment") as HTMLInputElement).value;

    if (!Number.isInteger(ingredientId) || ingredientId <= 0) {
      if (ingredientError) ingredientError.textContent = "Оберіть інгредієнт";
      return;
    }
    const quantity = Number(quantityRaw);
    if (!Number.isFinite(quantity) || quantity === 0) {
      if (quantityError) quantityError.textContent = "Введіть ненульову кількість";
      return;
    }
    if (movementType !== "adjustment" && quantity < 0) {
      if (quantityError) quantityError.textContent = "Кількість має бути додатною";
      return;
    }

    void (async () => {
      const result = await createIngredientMovement({
        ingredientId,
        productId: productIdRaw ? Number(productIdRaw) : null,
        movementType,
        quantity,
        comment,
      });

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeMovementModal();
      await movementsTable.refresh();
    })();
  });
}

const movementsTable = createSimpleAdminTable<ApiAdminIngredientMovement>({
  title: "Рух інгредієнтів",
  hint: "Журнал фактичних списань і надходжень сировини — кожен запис одразу змінює залишок на складі.",
  searchPlaceholder: "Пошук за назвою інгредієнта…",
  emptyHtml: EMPTY_MOVEMENTS_HTML,
  theadHtml: MOVEMENT_TABLE_THEAD,
  colgroupHtml: MOVEMENT_TABLE_COLGROUP,
  pageSize: 10,
  fetchAll: getIngredientMovements,
  getId: (m) => m.id,
  matchesQuery: (m, q) => m.ingredientName.toLowerCase().includes(q),
  rowHtml: movementRowHtml,
  previewBodyHtml: (m) => `
    <div class="admin-preview__header">
      <h2 class="admin-preview__name">${escapeHtml(m.ingredientName)}</h2>
      <span class="admin-preview__id">ID: ${m.id}</span>
    </div>
    ${previewFieldHtml("tag", "Тип руху", escapeHtml(movementTypeLabel(m.movementType)))}
    ${previewFieldHtml("hash", "Кількість", movementQuantityHtml(m))}
    ${m.productName ? previewFieldHtml("tag", "Продукт", escapeHtml(m.productName)) : ""}
    ${m.comment ? previewFieldHtml("hash", "Коментар", escapeHtml(m.comment)) : ""}
    ${previewFieldHtml("calendar", "Дата", formatDateTime(m.createdAt))}`,
  confirmTitle: () => "Видалити цей рух?",
  confirmMessage: (m) =>
    `Рух «${movementTypeLabel(m.movementType)}» по «${m.ingredientName}» буде видалено, а залишок на складі — повернено назад.`,
  deleteOne: deleteIngredientMovement,
  addButtonLabel: "+ Додати рух",
  onAdd: () => void openMovementModal(),
});

// ==============================
// Способи оплати — лише перегляд + видалення (див. коментар біля
// роутів server.js: створює й редагує СВІЙ спосіб оплати тільки сам
// покупець, з попапу в шапці сайту — не адмінка).
// ==============================

const PAYMENT_METHOD_TYPE_LABELS: Record<string, string> = {
  card: "Банківська картка",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Готівка кур'єру",
};

function paymentMethodTypeLabel(type: string): string {
  return PAYMENT_METHOD_TYPE_LABELS[type] ?? type;
}

function defaultBadgeHtml(isDefault: boolean): string {
  return `<span class="admin-table__badge${isDefault ? " admin-table__badge--accent" : ""}">${
    isDefault ? "Основний" : "Додатковий"
  }</span>`;
}

function paymentMethodRowHtml(p: ApiAdminPaymentMethod, isActive: boolean): string {
  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
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
const PAYMENT_METHOD_TABLE_THEAD = `
  <tr>
    <th>Користувач</th>
    <th>Тип</th>
    <th>Назва</th>
    <th>Статус</th>
    <th></th>
  </tr>`;

const EMPTY_PAYMENT_METHODS_HTML = `<div class="admin-categories-empty">Способів оплати ще немає — їх додають самі покупці зі свого меню.</div>`;

const paymentMethodsTable = createSimpleAdminTable<ApiAdminPaymentMethod>({
  title: "Методи оплати",
  hint: "Способи оплати додають самі покупці зі свого меню — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за користувачем або email…",
  emptyHtml: EMPTY_PAYMENT_METHODS_HTML,
  theadHtml: PAYMENT_METHOD_TABLE_THEAD,
  colgroupHtml: PAYMENT_METHOD_TABLE_COLGROUP,
  pageSize: 8,
  fetchAll: getAdminPaymentMethods,
  getId: (p) => p.id,
  matchesQuery: (p, q) => p.userFullName.toLowerCase().includes(q) || p.userEmail.toLowerCase().includes(q),
  rowHtml: paymentMethodRowHtml,
  previewBodyHtml: (method) => `
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
    ${previewFieldHtml("calendar", "Додано", formatDateTime(method.createdAt))}`,
  confirmTitle: () => "Видалити спосіб оплати?",
  confirmMessage: (p) =>
    `Спосіб оплати «${paymentMethodTypeLabel(p.type)}» користувача «${p.userFullName}» буде видалено безповоротно.`,
  deleteOne: deleteAdminPaymentMethod,
});


// ==============================
// Список бажаного / Кошики / Предмети кошика — три таблиці з ідентичним
// патерном "лише перегляд + видалення" (наповнює сам покупець на сайті,
// не адмін — той самий підхід, що й Методи оплати вище). Замість ще
// трьох майже однакових ~300-рядкових копій пошуку/пагінації/прев'ю —
// одна фабрика з невеликим конфігом на кожну таблицю.
// ==============================

interface SimpleAdminTableConfig<T, Id extends string | number = number> {
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
  deleteOne?: (id: Id) => Promise<DeleteResult>;
  getId: (item: T) => Id;
  // Як розпарсити id назад із data-атрибута (рядок) — потрібно лише
  // таблицям з нечисловим id (Users: "u_..."; Sessions: token). За
  // замовчуванням — Number(raw), підходить для решти таблиць.
  parseId?: (raw: string) => Id;
  matchesQuery: (item: T, q: string) => boolean;
  rowHtml: (item: T, isActive: boolean) => string;
  // Прев'ю без самої кнопки видалення знизу — її додає фабрика (коли
  // deleteOne заданий), щоб текст підтвердження й обробник були в
  // одному місці.
  previewBodyHtml: (item: T) => string;
  confirmTitle?: (item: T) => string;
  confirmMessage?: (item: T) => string;
  // Текст кнопки видалення знизу прев'ю — за замовчуванням "Видалити",
  // сесії використовують "Завершити сесію" (сама дія не "видалення
  // запису", а логаут користувача).
  deleteButtonLabel?: string;
  // Кнопка "Редагувати" — і в рядку (рендерить сам rowHtml), і знизу
  // прев'ю-панелі (додає сама фабрика, той самий принцип, що з
  // deleteActionsHtml нижче) — відкриває свою модалку редагування
  // (та сама схема, що в категорій/тегів/юзерів: openXModal(id) живе в
  // config.onEdit, сама фабрика формою не керує).
  onEdit?: (item: T) => void;
  // Особливий побічний ефект після успішного видалення замість
  // звичайного "перезапитати список" — наразі лише сесії (див.
  // коментар біля handleDelete). reload() — той самий loadAndRender.
  afterDelete?: (item: T, reload: () => Promise<void>) => Promise<void> | void;
  // Кнопка "+ Додати" у шапці розділу (поруч з підказкою, той самий
  // вигляд/місце, що раніше в кожної таблиці окремо) — відсутня, якщо
  // записи створює не адмін (Users/Sessions/Payment methods тощо).
  addButtonLabel?: string;
  onAdd?: () => void;
  // Викликається одразу після того, як прев'ю-панель намальована
  // (previewBodyHtml вже в DOM) — місце для власних елементів
  // керування, яких загальна фабрика не передбачає. reload() —
  // перезапитати весь список і перемалювати панель, якщо власний
  // контрол щось змінив на сервері.
  afterPreviewRender?: (item: T, panel: HTMLElement, reload: () => Promise<void>) => void;
}

function createSimpleAdminTable<T, Id extends string | number = number>(
  config: SimpleAdminTableConfig<T, Id>
): { render: () => void; refresh: () => Promise<void> } {
  let all: T[] = [];
  let searchQuery = "";
  let page = 1;
  let previewId: Id | null = null;
  const parseId = config.parseId ?? ((raw: string) => Number(raw) as Id);

  const rootId = "admin-view";
  const wrapId = `admin-simple-${config.title}-wrap`; // унікально в межах одного відкритого view
  const paginationId = `admin-simple-${config.title}-pagination`;
  const previewPanelId = `admin-simple-${config.title}-preview`;
  const searchId = `admin-simple-${config.title}-search`;
  const clearId = `admin-simple-${config.title}-search-clear`;
  const addBtnId = `admin-simple-${config.title}-add`;

  function filtered(): T[] {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((item) => config.matchesQuery(item, q));
  }

  function highlightActiveRow(): void {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]").forEach((tr) => {
      tr.classList.toggle("admin-table__row--active", tr.dataset.rowId === String(previewId));
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

    // Повний список кнопок 1..totalPages ламався при десятках сторінок
    // (сотні записів) — ряд кнопок просто вилазив за межі картки
    // (overflow), бо гумовому flex нема куди їх стиснути. Замість
    // цього — "розумний" список з трьома сусідами поточної сторінки і
    // першою/останньою, з "…" на пропущені проміжки (типовий патерн
    // пагінації), який завжди влазить у ширину картки.
    const pageNumbers = paginationPageList(page, totalPages);
    let pageButtons = "";
    for (const p of pageNumbers) {
      if (p === "…") {
        pageButtons += `<span class="admin-pagination__ellipsis" aria-hidden="true">…</span>`;
      } else {
        pageButtons += `<button class="admin-pagination__page${
          p === page ? " admin-pagination__page--active" : ""
        }" data-page="${p}" type="button">${p}</button>`;
      }
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
    // afterDelete — коли видалення має особливий побічний ефект понад
    // "перезапитати список" (сесії: якщо адмін завершив ВЛАСНУ поточну
    // сесію — це логаут, і треба редірект на index.html, а не просто
    // оновлений список).
    if (config.afterDelete) {
      await config.afterDelete(item, loadAndRender);
    } else {
      await loadAndRender();
    }
  }

  function renderPreviewPanel(): void {
    const panel = document.getElementById(previewPanelId);
    if (!panel) return;

    const item = all.find((i) => config.getId(i) === previewId);
    if (!item) {
      panel.innerHTML = `<div class="admin-preview-empty">Оберіть рядок зі списку, щоб переглянути&nbsp;деталі.</div>`;
      return;
    }

    const editActionsHtml = config.onEdit ? `<button class="btn btn--ghost" data-preview-edit type="button">Редагувати</button>` : "";
    const deleteActionsHtml = config.deleteOne
      ? `<button class="btn btn--danger" data-preview-delete type="button">${escapeHtml(
          config.deleteButtonLabel ?? "Видалити"
        )}</button>`
      : "";
    const actionsHtml =
      editActionsHtml || deleteActionsHtml
        ? `<div class="admin-preview__actions">${editActionsHtml}${deleteActionsHtml}</div>`
        : "";

    panel.innerHTML = `${config.previewBodyHtml(item)}${actionsHtml}`;
    animatePreviewPanelIn(panel);
    config.afterPreviewRender?.(item, panel, loadAndRender);

    panel.querySelector("[data-preview-edit]")?.addEventListener("click", () => {
      config.onEdit?.(item);
    });
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

    const openPreview = (id: Id): void => {
      previewId = id;
      highlightActiveRow();
      renderPreviewPanel();
    };

    wrap.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;

      const previewBtn = target.closest<HTMLButtonElement>("[data-preview]");
      if (previewBtn) {
        openPreview(parseId(previewBtn.dataset.preview ?? ""));
        return;
      }

      const deleteBtn = target.closest<HTMLButtonElement>("[data-delete]");
      if (deleteBtn) {
        const id = parseId(deleteBtn.dataset.delete ?? "");
        const item = all.find((i) => config.getId(i) === id);
        if (!item) return;
        void handleDelete(item);
        return;
      }

      const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
      if (editBtn) {
        const id = parseId(editBtn.dataset.edit ?? "");
        const item = all.find((i) => config.getId(i) === id);
        if (item) config.onEdit?.(item);
        return;
      }

      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const row = target.closest<HTMLTableRowElement>("tr[data-row-id]");
        if (row) openPreview(parseId(row.dataset.rowId ?? ""));
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
            ${
              config.onAdd
                ? `<button class="btn btn--primary-sm admin-add-btn" id="${addBtnId}" type="button">${escapeHtml(
                    config.addButtonLabel ?? "+ Додати"
                  )}</button>`
                : ""
            }
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
    if (config.onAdd) {
      document.getElementById(addBtnId)?.addEventListener("click", () => config.onAdd!());
    }

    setupSearch();
    setupTableEvents();
    void loadAndRender();
  }

  // refresh — перезапитати дані й перемалювати тільки тіло таблиці й
  // прев'ю-панель, БЕЗ повного render(): той скидає previewId/пошук/
  // сторінку і призначений лише для першого відкриття розділу
  // (навігація по хешу). refresh — для випадків "щось помінялось на
  // сервері, треба оновити список, не закриваючи відкриту панель"
  // (наприклад після зміни статусу замовлення в своїй модалці).
  return { render, refresh: loadAndRender };
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
    ${previewFieldHtml("calendar", "Створено", formatDateTime(c.createdAt))}
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Товари в кошику</span>
      ${
        c.items.length
          ? `<ul class="admin-product-preview-recipe-list">${c.items
              .map((it) => recipeListItemHtml(null, `${escapeHtml(it.productName)} — ${it.quantity} шт.`))
              .join("")}</ul>`
          : `<p class="admin-product-tags-empty">Кошик порожній.</p>`
      }
    </div>`,
  confirmTitle: () => "Видалити кошик?",
  confirmMessage: (c) =>
    `Кошик користувача «${c.userFullName ?? "Гість"}» разом з усіма товарами (${
      c.itemsCount
    }) буде видалено безповоротно.`,
});

const cartItemsTable = createSimpleAdminTable<ApiAdminCartItem>({
  title: "Предмети кошика",
  hint: "Товари, додані до кошиків покупців — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за товаром, власником кошика або email…",
  emptyHtml: `<div class="admin-categories-empty">Предметів кошика ще немає.</div>`,
  theadHtml: `<tr><th>Кошик</th><th>Товар</th><th>Кількість</th><th>Додано</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:110px" /><col style="width:170px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminCartItems,
  deleteOne: deleteAdminCartItem,
  getId: (i) => i.id,
  matchesQuery: (i, q) =>
    i.cartOwner.toLowerCase().includes(q) ||
    (i.cartOwnerEmail ?? "").toLowerCase().includes(q) ||
    i.productName.toLowerCase().includes(q),
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
    ${i.cartOwnerEmail ? previewFieldHtml("email", "Email", escapeHtml(i.cartOwnerEmail)) : ""}
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
// Замовлення й товарні позиції замовлень — той самий підхід, що й
// кошики/предмети кошика вище (createSimpleAdminTable), тільки дані
// наповнює не сам покупець довільно, а оформлення замовлення на сайті
// (/api/orders). Видалення тут — прибрати запис із БД (адмінська
// операція), склад назад НЕ повертається (дивись коментар біля
// DELETE /api/admin/orders/:id у server.js).
// ==============================

function orderItemRowHtml(item: { productName: string; productImageUrl: string | null; quantity: number }): string {
  const icon = item.productImageUrl
    ? `<img class="admin-order-item-icon skeleton" src="${item.productImageUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-product-preview-recipe-icon" aria-hidden="true"></span>`;
  return `
    <li class="admin-product-preview-recipe-item">
      ${icon}
      <span class="admin-product-preview-recipe-text">${escapeHtml(item.productName)} — ${item.quantity} шт.</span>
    </li>`;
}

function orderItemsListHtml(items: { productName: string; productImageUrl: string | null; quantity: number }[]): string {
  if (!items.length) return `<p class="admin-product-tags-empty">Порожнє замовлення.</p>`;
  return `<ul class="admin-product-preview-recipe-list">${items.map(orderItemRowHtml).join("")}</ul>`;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Очікує обробки",
  processing: "Збирається",
  delivering: "Доставляється",
  completed: "Виконано",
  cancelled: "Скасовано",
};
const ORDER_STATUS_OPTIONS = Object.keys(ORDER_STATUS_LABELS);

// Колір статусу — суто візуальне маркування в таблиці/прев'ю (клас
// .admin-order-status--<статус>, стилі в main.css): скасовано червоним,
// виконано зеленим, доставляється синім, решта — нейтральним
// приглушеним, щоб не плутати з "усе гаразд" (completed).
function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

function orderStatusBadgeHtml(status: string): string {
  return `<span class="admin-order-status admin-order-status--${escapeHtml(status)}">${escapeHtml(
    orderStatusLabel(status)
  )}</span>`;
}

// ---- Модалка редагування статусу замовлення — та сама схема, що в
// категорій/тегів/юзерів (openXModal/closeXModal/setupXModal + власна
// розмітка в admin.html), лише одне поле замість форми, бо єдине, що
// тут можна міняти, — статус (сума/адреса/товари — факт покупки на
// момент оформлення, заднім числом їх не підправляють). ----

let orderStatusModalId: number | null = null;

function onOrderStatusModalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeOrderStatusModal();
}

function openOrderStatusModal(order: ApiAdminOrder): void {
  const modal = document.getElementById("admin-order-status-modal");
  const select = document.getElementById("admin-order-status-select") as HTMLSelectElement | null;
  const message = document.getElementById("admin-order-status-message");
  const submitBtn = document.getElementById("admin-order-status-modal-submit") as HTMLButtonElement | null;
  if (!modal || !select) return;

  orderStatusModalId = order.id;
  select.innerHTML = ORDER_STATUS_OPTIONS.map(
    (s) => `<option value="${s}"${s === order.status ? " selected" : ""}>${escapeHtml(orderStatusLabel(s))}</option>`
  ).join("");
  if (message) {
    message.textContent = "";
    message.classList.remove("form-message--visible", "form-message--error");
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Зберегти";
  }

  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onOrderStatusModalKeydown);
  select.focus();
}

function closeOrderStatusModal(): void {
  const modal = document.getElementById("admin-order-status-modal");
  if (!modal) return;
  orderStatusModalId = null;
  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onOrderStatusModalKeydown);
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function setupOrderStatusModal(): void {
  const modal = document.getElementById("admin-order-status-modal");
  const closeBtn = document.getElementById("admin-order-status-modal-close");
  const backdrop = modal?.querySelector(".auth-modal__backdrop");
  closeBtn?.addEventListener("click", closeOrderStatusModal);
  backdrop?.addEventListener("click", closeOrderStatusModal);

  const form = document.getElementById("admin-order-status-form") as HTMLFormElement | null;
  const select = document.getElementById("admin-order-status-select") as HTMLSelectElement | null;
  const message = document.getElementById("admin-order-status-message");
  const submitBtn = document.getElementById("admin-order-status-modal-submit") as HTMLButtonElement | null;

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (orderStatusModalId === null || !select || !submitBtn) return;

    void (async () => {
      if (message) {
        message.textContent = "";
        message.classList.remove("form-message--visible", "form-message--error");
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Збереження…";

      const result = await updateAdminOrderStatus(orderStatusModalId as number, select.value);

      if (!result.ok) {
        if (message) {
          message.textContent = result.error;
          message.classList.add("form-message--visible", "form-message--error");
        }
        submitBtn.disabled = false;
        submitBtn.textContent = "Зберегти";
        return;
      }

      closeOrderStatusModal();
      void ordersTable.refresh();
    })();
  });
}

const ordersTable = createSimpleAdminTable<ApiAdminOrder>({
  title: "Замовлення",
  hint: "Замовлення покупців, оформлені на сайті, та їхні статуси — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за користувачем або email…",
  emptyHtml: `<div class="admin-categories-empty">Замовлень ще немає.</div>`,
  theadHtml: `<tr><th>Покупець</th><th>Товарів</th><th>Сума</th><th>Статус</th><th>Створено</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col style="width:100px" /><col style="width:110px" /><col style="width:150px" /><col style="width:170px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminOrders,
  deleteOne: deleteAdminOrder,
  getId: (o) => o.id,
  matchesQuery: (o, q) => o.userFullName.toLowerCase().includes(q) || o.userEmail.toLowerCase().includes(q),
  rowHtml: (o, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${o.id}">
      <td class="admin-table__user-cell" title="${escapeHtml(o.userFullName)}">
        <span class="admin-table__user-name">${escapeHtml(o.userFullName)}</span>
        <span class="admin-table__subtext">${escapeHtml(o.userEmail)}</span>
      </td>
      <td class="admin-table__description-cell">${o.itemsCount}</td>
      <td class="admin-table__description-cell">${formatCurrency(o.totalAmount)}</td>
      <td class="admin-table__description-cell">${orderStatusBadgeHtml(o.status)}</td>
      <td class="admin-table__description-cell">${formatDateTime(o.createdAt)}</td>
      <td class="admin-table__actions-cell">
        <div class="admin-table__actions">
          <button class="admin-table__preview-btn" data-preview="${o.id}" type="button" aria-label="Переглянути">
            ${actionIconHtml("preview")}<span class="admin-table__action-label">Переглянути</span>
          </button>
          <button class="admin-table__edit-btn" data-edit="${o.id}" type="button" aria-label="Редагувати">
            ${actionIconHtml("edit")}<span class="admin-table__action-label">Редагувати</span>
          </button>
          <button class="admin-table__delete-btn" data-delete="${o.id}" type="button" aria-label="Видалити">
            ${actionIconHtml("delete")}<span class="admin-table__action-label">Видалити</span>
          </button>
        </div>
      </td>
    </tr>`,
  previewBodyHtml: (o) => `
    <div class="admin-preview__user-header">
      <span class="admin-preview__avatar" aria-hidden="true">${escapeHtml(
        o.userFullName.trim().charAt(0).toUpperCase() || "?"
      )}</span>
      <div>
        <h2 class="admin-preview__name">Замовлення №${o.id}</h2>
      </div>
    </div>
    ${previewFieldHtml("email", "Покупець", `${escapeHtml(o.userFullName)} (${escapeHtml(o.userEmail)})`)}
    ${previewFieldHtml("wallet", "Сума", formatCurrency(o.totalAmount))}
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Статус</span>
      <p class="admin-preview__field-value">${orderStatusBadgeHtml(o.status)}</p>
    </div>
    ${previewFieldHtml("tag", "Адреса доставки", escapeHtml(o.deliveryAddress))}
    ${previewFieldHtml("phone", "Телефон", escapeHtml(o.contactPhone))}
    ${previewFieldHtml("calendar", "Створено", formatDateTime(o.createdAt))}
    <div class="admin-preview__field">
      <span class="admin-preview__field-label">Товари в замовленні</span>
      ${orderItemsListHtml(o.items)}
    </div>`,
  confirmTitle: () => "Видалити замовлення?",
  confirmMessage: (o) => `Замовлення №${o.id} користувача «${o.userFullName}» буде видалено безповоротно.`,
  onEdit: (o) => openOrderStatusModal(o),
});

const orderItemsTable = createSimpleAdminTable<ApiAdminOrderItem>({
  title: "Продукти замовлення",
  hint: "Товарні позиції у складі замовлень — тут лише перегляд і видалення.",
  searchPlaceholder: "Пошук за товаром, покупцем або email…",
  emptyHtml: `<div class="admin-categories-empty">Товарних позицій ще немає.</div>`,
  theadHtml: `<tr><th>Замовлення</th><th>Товар</th><th>Кількість</th><th>Ціна</th><th></th></tr>`,
  colgroupHtml: `<colgroup><col /><col /><col style="width:110px" /><col style="width:110px" /><col style="width:110px" /></colgroup>`,
  pageSize: 8,
  fetchAll: getAdminOrderItems,
  deleteOne: deleteAdminOrderItem,
  getId: (i) => i.id,
  matchesQuery: (i, q) =>
    i.orderOwner.toLowerCase().includes(q) ||
    (i.orderOwnerEmail ?? "").toLowerCase().includes(q) ||
    i.productName.toLowerCase().includes(q),
  rowHtml: (i, isActive) => `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${i.id}">
      <td class="admin-table__description-cell" title="${escapeHtml(i.orderOwner)}">№${i.orderId} · ${escapeHtml(
    i.orderOwner
  )}</td>
      <td class="admin-table__description-cell">${escapeHtml(i.productName)}</td>
      <td class="admin-table__description-cell">${i.quantity}</td>
      <td class="admin-table__description-cell">${formatCurrency(i.priceAtPurchase)}</td>
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
    ${previewFieldHtml("tag", "Замовлення", `№${i.orderId} · ${escapeHtml(i.orderOwner)}`)}
    ${i.orderOwnerEmail ? previewFieldHtml("email", "Email", escapeHtml(i.orderOwnerEmail)) : ""}
    ${previewFieldHtml("hash", "Кількість", String(i.quantity))}
    ${previewFieldHtml("wallet", "Ціна за одиницю", formatCurrency(i.priceAtPurchase))}`,
  confirmTitle: () => "Видалити товарну позицію?",
  confirmMessage: (i) => `«${i.productName}» (${i.quantity} шт.) буде прибрано із замовлення №${i.orderId}.`,
});

// ==============================
// Продукти — повний CRUD, найскладніша таблиця адмінки: крім своїх
// полів (категорія, ціна, харчова цінність...) форма редагує ще дві
// вкладені сутності прямо тут — рецепт (product_recipes) і теги
// (product_tags), той самий підхід, що прохав власник: "щоб можна було
// пов'язувати в меню редагування або додавання запису продукту", а не
// окремою формою.
// ==============================

// Довідники для селектів у формі — категорія/теги/інгредієнти можуть
// знадобитись, навіть якщо адмін ще не відкривав відповідні таблиці,
// тож тягнемо їх окремо тут, а не покладаємось на allCategories/
// allTags/allIngredients з інших розділів (ті заповнюються лише коли
// відкрита ЇХНЯ таблиця).
let productFormCategories: ApiCategory[] = [];
let productFormTags: ApiTag[] = [];
let productFormIngredients: ApiIngredient[] = [];

type ProductModalMode = { type: "create" } | { type: "edit"; product: ApiProduct };
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

function categoryNameById(id: number): string {
  return productFormCategories.find((c) => c.id === id)?.name ?? "—";
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

function productRowHtml(p: ApiProduct, isActive: boolean): string {
  const icon = p.imageUrl
    ? `<img class="admin-table__icon skeleton" src="${p.imageUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr class="${isActive ? "admin-table__row--active" : ""}" data-row-id="${p.id}">
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
const PRODUCT_TABLE_THEAD = `
  <tr>
    <th>ID</th>
    <th></th>
    <th>Назва</th>
    <th>Категорія</th>
    <th>Ціна</th>
    <th>Залишок</th>
    <th></th>
  </tr>`;

const EMPTY_PRODUCTS_HTML = `<div class="admin-categories-empty">Продуктів ще немає — додайте перший нижче.</div>`;

// Іконка-заглушка перед кожним рядком списку — той самий принцип, що
// й PREVIEW_ICONS вище (mask-image, колір бере CSS), просто своя
// маленька обгортка, бо тут рядки в списку, а не пари label/value.
function recipeListItemHtml(iconUrl: string | null, label: string): string {
  const icon = iconUrl
    ? `<img class="admin-order-item-icon skeleton" src="${iconUrl}" alt="" aria-hidden="true" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
    : `<span class="admin-product-preview-recipe-icon" aria-hidden="true"></span>`;
  return `
    <li class="admin-product-preview-recipe-item">
      ${icon}
      <span class="admin-product-preview-recipe-text">${label}</span>
    </li>`;
}

function productRecipeListHtml(p: ApiProduct): string {
  if (!p.recipes.length) return `<p class="admin-product-tags-empty">Рецепт не задано.</p>`;
  return `<ul class="admin-product-preview-recipe-list">${p.recipes
    .map((r: ApiProductRecipeItem) =>
      recipeListItemHtml(
        r.ingredientIconUrl,
        `${escapeHtml(r.ingredientName)} — ${formatQuantity(r.quantity)} ${escapeHtml(r.ingredientUnit)}`
      )
    )
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

const productsTable = createSimpleAdminTable<ApiProduct>({
  title: "Продукти",
  hint: "Тут знаходиться каталог продукції, який включає в себе випічку та інші товари.",
  searchPlaceholder: "Пошук за назвою…",
  emptyHtml: EMPTY_PRODUCTS_HTML,
  theadHtml: PRODUCT_TABLE_THEAD,
  colgroupHtml: PRODUCT_TABLE_COLGROUP,
  pageSize: 8,
  // Довідники (категорії/теги) потрібні преview-панелі й рядкам таблиці
  // для назв — тягнемо їх одночасно з самими продуктами, а не лише в
  // момент відкриття модалки.
  fetchAll: async () => {
    const [products] = await Promise.all([
      getProducts(),
      (async () => {
        [productFormCategories, productFormTags] = await Promise.all([getCategories(), getTags()]);
      })(),
    ]);
    return products;
  },
  getId: (p) => p.id,
  matchesQuery: (p, q) => p.name.toLowerCase().includes(q),
  rowHtml: productRowHtml,
  previewBodyHtml: (product) => {
    const icon = product.imageUrl
      ? `<img class="admin-preview__icon skeleton" src="${product.imageUrl}" alt="" onload="this.classList.remove('skeleton')" onerror="this.remove()" />`
      : `<span class="admin-preview__icon admin-preview__icon--placeholder"></span>`;
    return `
      <div class="admin-preview__header">
        <h2 class="admin-preview__name">${escapeHtml(product.name)}</h2>
        <span class="admin-preview__id">ID: ${product.id}</span>
      </div>
      ${icon}
      ${previewFieldHtml("tag", "Категорія", escapeHtml(categoryNameById(product.categoryId)))}
      ${previewFieldHtml("price", "Ціна", productPriceHtml(product))}
      ${previewFieldHtml("stock", "Залишок", `${product.stockQuantity} шт`)}
      ${product.weight ? previewFieldHtml("weight", "Вага/об'єм", escapeHtml(product.weight)) : ""}
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
      </div>`;
  },
  confirmTitle: () => "Видалити продукт?",
  confirmMessage: (p) => `«${p.name}» буде видалено безповоротно, разом з рецептом і тегами.`,
  deleteOne: deleteProduct,
  onEdit: (product) => void openProductModal({ type: "edit", product }),
  addButtonLabel: "+ Додати продукт",
  onAdd: () => void openProductModal({ type: "create" }),
});

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
    const product = mode.product;
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

// Строго дозволяє вводити лише цифри (і, за потреби, одну десяткову
// крапку) — на відміну від самого лише type="number", яке в деяких
// браузерах усе ще пропускає літеру "e" (наукова нотація) чи вставку
// довільного тексту через paste. Чистить значення на кожному введенні,
// а не лише при сабміті — щоб некоректний символ просто не з'являвся
// в полі.
function restrictToNumericInput(input: HTMLInputElement, allowDecimal: boolean, allowNegative = false): void {
  input.addEventListener("input", () => {
    let cleaned = allowDecimal ? input.value.replace(/[^\d.-]/g, "") : input.value.replace(/[^\d-]/g, "");
    if (!allowNegative) {
      cleaned = cleaned.replace(/-/g, "");
    } else {
      // Мінус має сенс лише один і рівно на початку — "1-2" чи "--5" не
      // повинні проходити.
      const negative = cleaned.startsWith("-");
      cleaned = cleaned.replace(/-/g, "");
      if (negative) cleaned = `-${cleaned}`;
    }
    if (allowDecimal) {
      const dotIndex = cleaned.indexOf(".");
      if (dotIndex !== -1) {
        cleaned = cleaned.slice(0, dotIndex + 1) + cleaned.slice(dotIndex + 1).replace(/\./g, "");
      }
    }
    if (cleaned !== input.value) input.value = cleaned;
  });
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

  // Вага/об'єм — єдине з цих полів, що технічно type="text" (бо туди
  // вписують і грами, і літри), решта вже type="number", але той сам
  // по собі ще пропускає "e"/вставку тексту в деяких браузерах —
  // restrictToNumericInput підчищає це для всіх одразу.
  const numericFieldIds: [string, boolean][] = [
    ["admin-product-weight", true],
    ["admin-product-shelf-life", false],
    ["admin-product-calories", true],
    ["admin-product-proteins", true],
    ["admin-product-fats", true],
    ["admin-product-carbs", true],
    ["admin-product-price", true],
    ["admin-product-discount", false],
    ["admin-product-stock", false],
  ];
  for (const [id, allowDecimal] of numericFieldIds) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) restrictToNumericInput(el, allowDecimal);
  }

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
          ? await updateProduct(productModalMode.product.id, input)
          : await createProduct(input);

      if (!result.ok) {
        showMessage(result.error, true);
        return;
      }

      closeProductModal();
      await productsTable.refresh();
    })();
  });
}

async function renderTableView(key: string): Promise<void> {
  const table = TABLES.find((t) => t.key === key);
  if (!table) {
    window.location.hash = "";
    return;
  }

  if (table.key === "categories") {
    categoriesTable.render();
  } else if (table.key === "tags") {
    tagsTable.render();
  } else if (table.key === "user_tag_preferences") {
    prefsTable.render();
  } else if (table.key === "users") {
    usersTable.render();
  } else if (table.key === "sessions") {
    sessionsTable.render();
  } else if (table.key === "ingredients") {
    ingredientsTable.render();
  } else if (table.key === "ingredient_movements") {
    movementsTable.render();
  } else if (table.key === "payment_methods") {
    paymentMethodsTable.render();
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
    productsTable.render();
  } else if (table.key === "orders") {
    ordersTable.render();
  } else if (table.key === "order_items") {
    orderItemsTable.render();
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
  setupMovementModal();
  setupProductModal();
  setupOrderStatusModal();
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

