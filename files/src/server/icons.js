// ==============================
// Іконки (категорії/теги/інгредієнти/продукти) — спільні константи й
// прибирання файлу старої іконки при заміні/видаленні запису.
// Використовується з routes/categories.js, routes/tags.js,
// routes/ingredients.js, routes/products.js і routes/uploadIcon.js.
// ==============================

const path = require("path");
const fs = require("node:fs");
const { ROOT_DIR } = require("./paths");

// Білий список — те саме, що ADMIN_TABLES в db.js: жодного довільного
// шляху від клієнта, лише ці директорії.
const ICON_KIND_DIRS = {
  categories: "categories",
  tags: "tags",
  ingredients: "ingredients",
  products: "products",
};
const MAX_ICON_BYTES = 3 * 1024 * 1024; // 3MB — з запасом для іконки

const ICON_MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

// Прибираємо файл іконки лише якщо він лежить у одній з "наших" папок
// (assets/icons/categories чи assets/icons/tags) — щоб не видалити щось
// за довільним зовнішнім посиланням, яке хтось міг вписати вручну через
// API напряму.
function deleteOwnedIconFile(iconUrl) {
  if (typeof iconUrl !== "string") return;
  const ownedPrefix = Object.values(ICON_KIND_DIRS).find((dir) => iconUrl.startsWith(`assets/icons/${dir}/`));
  if (!ownedPrefix) return;
  try {
    fs.unlinkSync(path.join(ROOT_DIR, iconUrl));
  } catch {
    // Файла вже нема (чи ще щось) — це best-effort прибирання, не критично.
  }
}

module.exports = { ICON_KIND_DIRS, MAX_ICON_BYTES, ICON_MIME_TO_EXT, deleteOwnedIconFile };
