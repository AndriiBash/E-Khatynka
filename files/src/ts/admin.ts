import {
  getSession,
  logout,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  uploadCategoryIcon,
  getTableCounts,
} from "./storage.js";
import { initPreloader, hidePreloader } from "./preloader.js";
import { userMenuHtml, setupUserMenu } from "./user-menu.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";
import type { ApiCategory } from "./types.js";

// ==============================
// Адмін-панель. Головна — плитки з назвами таблиць БД (той самий
// список, що на ER-діаграмі й у server.js/ADMIN_TABLES). З реальним
// CRUD поки лише "Категорії" (звідти й бере дані сайдбар покупця в
// catalog.ts) — решта таблиць відкривається заглушкою "У розробці".
//
// Захист сторінки — лише на клієнті: не-адмін (чи взагалі не
// залогинений) одразу відлітає на index.html. Сам /api/admin/*
// бекенд прикритий по-справжньому (requireAdmin у server.js), а от
// HTML тут — ні, це UI-guard, не заміна серверної перевірки.
// ==============================

interface TableDef {
  key: string;
  label: string;
}

// Той самий список і порядок, що в server.js (ADMIN_TABLES).
const TABLES: TableDef[] = [
  { key: "users", label: "Користувачі" },
  { key: "sessions", label: "Сесії" },
  { key: "payment_methods", label: "Методи оплати" },
  { key: "orders", label: "Замовлення" },
  { key: "order_items", label: "Продукти замовлення" },
  { key: "products", label: "Продукти" },
  { key: "categories", label: "Категорії" },
  { key: "carts", label: "Кошики" },
  { key: "cart_items", label: "Предмети кошика" },
  { key: "wishlists", label: "Списки бажаного" },
  { key: "ingredient_types", label: "Типи інгредієнтів" },
  { key: "ingredients", label: "Інгредієнти" },
  { key: "product_recipes", label: "Рецепти продуктів" },
  { key: "ingredient_movements", label: "Рух інгредієнтів" },
  { key: "user_ingredient_preferences", label: "Вподобання користувачів" },
];

// Теплі тони в стилі бренду (--color-accent), по колу — щоб плитки
// відрізнялись одна від одної, як на референсі.
const TILE_COLORS = [
  "#F4C978",
  "#E8B04C",
  "#F0DDA0",
  "#DE9A5C",
  "#F6E2B8",
  "#E7A96B",
  "#F1C79A",
  "#D98C4A",
];

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
// Роутинг усередині сторінки: #/table/<key> — конкретна таблиця,
// інакше (чи порожньо) — плитки. Справжніх переходів між сторінками
// нема, тож і "назад" у браузері працює природно.
// ==============================

function currentTableKey(): string | null {
  const m = window.location.hash.match(/^#\/table\/([a-z_]+)$/);
  return m ? m[1] : null;
}

function renderRoute(): void {
  const key = currentTableKey();
  if (key) {
    void renderTableView(key);
  } else {
    void renderHome();
  }
}

// ==============================
// Головна: плитки таблиць
// ==============================

async function renderHome(): Promise<void> {
  const root = document.getElementById("admin-view");
  if (!root) return;

  root.innerHTML = `
    <h1 class="admin-page__title">Таблиці бази даних</h1>
    <div class="admin-tiles">
      ${TABLES.map(
        (t, i) => `
        <button class="admin-tile" type="button" data-table="${t.key}" style="background:${TILE_COLORS[i % TILE_COLORS.length]}">
          <span class="admin-tile__label">${t.label}</span>
          <span class="admin-tile__count" id="admin-tile-count-${t.key}"></span>
        </button>`
      ).join("")}
    </div>`;

  root.querySelectorAll<HTMLButtonElement>("[data-table]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.hash = `#/table/${btn.dataset.table}`;
    });
  });

  const counts = await getTableCounts();
  if (!counts) return;
  for (const t of TABLES) {
    const el = document.getElementById(`admin-tile-count-${t.key}`);
    if (el && counts[t.key] !== undefined) el.textContent = pluralizeRecords(counts[t.key]);
  }
}

// ==============================
// Заглушка для ще не підключених таблиць
// ==============================

function renderStubTable(table: TableDef): void {
  const root = document.getElementById("admin-view");
  if (!root) return;

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <h1 class="admin-page__title">${table.label}</h1>
    <section class="admin-section">
      <div class="admin-categories-empty">Керування цією таблицею ще в розробці.</div>
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

const EDIT_ICON_SVG = `<svg class="admin-table__action-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15.5 4.5L19.5 8.5M3 21L3.6 17.8C3.7 17.2 4 16.6 4.4 16.2L15 5.6C15.8 4.8 17.1 4.8 17.9 5.6L18.4 6.1C19.2 6.9 19.2 8.2 18.4 9L7.8 19.6C7.4 20 6.8 20.3 6.2 20.4L3 21Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DELETE_ICON_SVG = `<svg class="admin-table__action-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M4 7H20M9 7V4.5C9 4 9.4 3.5 10 3.5H14C14.6 3.5 15 4 15 4.5V7M6 7L6.8 19C6.9 19.7 7.5 20.2 8.2 20.2H15.8C16.5 20.2 17.1 19.7 17.2 19L18 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function categoryRowHtml(c: ApiCategory): string {
  const icon = c.iconUrl
    ? `<img class="admin-table__icon" src="${c.iconUrl}" alt="" aria-hidden="true" onerror="this.remove()" />`
    : `<span class="admin-table__icon admin-table__icon--placeholder" aria-hidden="true"></span>`;

  return `
    <tr>
      <td class="admin-table__icon-cell">${icon}</td>
      <td class="admin-table__name-cell">${escapeHtml(c.name)}</td>
      <td class="admin-table__description-cell">${c.description ? escapeHtml(c.description) : "—"}</td>
      <td class="admin-table__actions-cell">
        <button class="admin-table__edit-btn" data-edit="${c.id}" type="button" aria-label="Редагувати">
          ${EDIT_ICON_SVG}<span class="admin-table__action-label">Редагувати</span>
        </button>
        <button class="admin-table__delete-btn" data-delete="${c.id}" type="button" aria-label="Видалити">
          ${DELETE_ICON_SVG}<span class="admin-table__action-label">Видалити</span>
        </button>
      </td>
    </tr>`;
}

const EMPTY_CATEGORIES_HTML = `
  <div class="admin-categories-empty">
    <img class="admin-categories-empty__icon" src="assets/images/empty-categories.png" alt="" aria-hidden="true" onerror="this.style.display='none'" />
    Категорій ще немає.<br />Додайте першу кнопкою вище.
  </div>`;

function renderCategoriesTableBody(): void {
  const wrap = document.getElementById("admin-categories-table-wrap");
  if (!wrap) return;

  if (!allCategories.length) {
    wrap.innerHTML = EMPTY_CATEGORIES_HTML;
    return;
  }

  wrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th></th>
          <th>Назва</th>
          <th>Опис</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${allCategories.map(categoryRowHtml).join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.edit);
      if (allCategories.some((c) => c.id === id)) openCategoryModal({ type: "edit", id });
    });
  });

  wrap.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.delete);
      const category = allCategories.find((c) => c.id === id);
      if (!category) return;

      void (async () => {
        const confirmed = await confirmDelete(category.name);
        if (!confirmed) return;
        const result = await deleteCategory(id);
        if (!result.ok) {
          // Рідкісний край-кейс (наприклад, гонка запитів — категорію
          // вже видалили в іншій вкладці) — модалка вже закрита,
          // простого alert() тут достатньо.
          window.alert(result.error);
          return;
        }
        await loadAndRenderCategories();
      })();
    });
  });
}

async function loadAndRenderCategories(): Promise<void> {
  allCategories = await getCategories();
  renderCategoriesTableBody();
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

  root.innerHTML = `
    <button class="admin-back" type="button" id="admin-back-btn">← Усі таблиці</button>
    <div class="admin-table-header">
      <h1 class="admin-page__title">Категорії</h1>
      <button class="btn btn--primary-sm admin-add-btn" id="admin-add-category-btn" type="button">+ Додати категорію</button>
    </div>

    <section class="admin-section admin-section--wide">
      <p class="admin-section__hint">Категорії, які ви тут додаєте, одразу зʼявляються у боковому меню каталогу для покупця.</p>
      <div id="admin-categories-table-wrap"></div>
    </section>`;

  document.getElementById("admin-back-btn")?.addEventListener("click", () => {
    window.location.hash = "";
  });
  document.getElementById("admin-add-category-btn")?.addEventListener("click", () => {
    openCategoryModal({ type: "create" });
  });

  void loadAndRenderCategories();
}

async function renderTableView(key: string): Promise<void> {
  const table = TABLES.find((t) => t.key === key);
  if (!table) {
    window.location.hash = "";
    return;
  }

  if (table.key === "categories") {
    renderCategoriesTable();
  } else {
    renderStubTable(table);
  }
}

// ==============================
// Модалка підтвердження видалення — та сама розмітка/класи, що й
// "Очистити кошик?" на index.html (auth-modal.css), просто своя копія
// в admin.html. Відкриття/закриття тут без прив'язки до конкретної дії
// — резолвиться через Promise<boolean>, підходить для будь-якого рядка.
// ==============================

function confirmDelete(categoryName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById("admin-delete-modal");
    const text = document.getElementById("admin-delete-modal-text");
    const cancelBtn = document.getElementById("admin-delete-modal-cancel");
    const confirmBtn = document.getElementById("admin-delete-modal-confirm");
    const closeBtn = document.getElementById("admin-delete-modal-close");
    const backdrop = modal?.querySelector(".auth-modal__backdrop");
    if (!modal || !cancelBtn || !confirmBtn || !closeBtn) {
      resolve(window.confirm(`Видалити категорію «${categoryName}»?`));
      return;
    }

    if (text) text.textContent = `Категорію «${categoryName}» буде видалено безповоротно.`;

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

