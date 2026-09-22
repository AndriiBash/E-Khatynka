// ==============================
// Локальний backend для Є-Хатинки: Express + вбудований у Node.js
// модуль node:sqlite (жодних зовнішніх БД чи нативних залежностей, які
// треба було б компілювати під платформу).
//
// Вимагає Node.js 22.5+ (node:sqlite з'явився саме там, як
// experimental-модуль — про це буде попередження в консолі, це
// нормально). Перевірити свою версію: `node -v`.
//
// Запуск:
//   npm install
//   npm run build   (компілює src/ts/*.ts у dist/js — фронтенд)
//   npm start        (піднімає цей сервер на http://localhost:3000)
//
// Сам файл — лише "склеювання": статика/сторінки нижче + підключення
// роутів з src/server/routes/*.js. Уся бізнес-логіка (SQL, валідація,
// схема БД, сесії) живе в src/server/**, розкладена по доменах —
// дивись src/server/routes/ для конкретних ендпоінтів.
// ==============================

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const { DB_PATH } = require("./src/server/db"); // ініціалізує БД, схему й сід адміна (побічний ефект require)

const app = express();
// Ліміт підняно з дефолтних 100kb — іконки категорій летять сюди ж, у
// вигляді base64 у JSON-тілі (дивись /api/admin/upload-icon).
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// ВАЖЛИВО: НЕ роздаємо весь __dirname як статику — там лежить
// data/ehatynka.db (хеші паролів!), server.js, package.json тощо.
// Явно віддаємо лише те, що дійсно потрібне браузеру.
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
// Прямий /index.html теж має працювати — інакше будь-яке відносне
// посилання href="index.html" (лого, 404-сторінка тощо), відкрите поки
// адреса в браузері вже "/", веде на /index.html, а такого маршруту не
// було — 404. Віддаємо той самий файл.
app.get("/index.html", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/404.html", (req, res) => res.sendFile(path.join(__dirname, "404.html")));
app.get("/product.html", (req, res) => res.sendFile(path.join(__dirname, "product.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.use("/dist", express.static(path.join(__dirname, "dist")));
app.use("/src/css", express.static(path.join(__dirname, "src", "css")));
app.use("/assets", express.static(path.join(__dirname, "assets")));

// ---- API-роути, по одному файлу на домен (src/server/routes/) ----
app.use(require("./src/server/routes/auth"));
app.use(require("./src/server/routes/categories"));
app.use(require("./src/server/routes/uploadIcon"));
app.use(require("./src/server/routes/tags"));
app.use(require("./src/server/routes/tagPreferences"));
app.use(require("./src/server/routes/wishlist"));
app.use(require("./src/server/routes/cart"));
app.use(require("./src/server/routes/orders"));
app.use(require("./src/server/routes/users"));
app.use(require("./src/server/routes/sessions"));
app.use(require("./src/server/routes/ingredients"));
app.use(require("./src/server/routes/ingredientMovements"));
app.use(require("./src/server/routes/paymentMethods"));
app.use(require("./src/server/routes/products"));
app.use(require("./src/server/routes/cartsAdmin"));
app.use(require("./src/server/routes/adminMeta"));

// Для будь-якого невідомого шляху без розширення файлу (тобто це не
// запит до /dist, /src, /assets тощо) — 404.html, той самий підхід, що
// й на статичному хостингу.
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "404.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Є-Хатинка: http://localhost:${PORT}`);
  console.log(`База даних: ${DB_PATH}`);
});
