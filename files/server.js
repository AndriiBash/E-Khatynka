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
// ==============================

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "ehatynka.db");

const db = new DatabaseSync(DB_PATH);

// Без цього SQLite мовчки ІГНОРУЄ всі FOREIGN KEY — вони в CREATE TABLE
// нижче лише документація, доки не увімкнено явно (за замовчуванням
// вимкнено в самому SQLite, і node:sqlite не вмикає сам).
db.exec("PRAGMA foreign_keys = ON;");

// Схема з ER-діаграми (users/sessions лишились як були — щоб не зламати
// вже написані /api/register, /api/login тощо; role/expires_at додані
// нові поля з діаграми). Всі інші таблиці — новий каталог/кошик/
// замовлення/склад інгредієнтів.
//
// НАЖИВО ВАЖЛИВО: CREATE TABLE IF NOT EXISTS не змінює вже існуючу
// таблицю. Якщо в тебе вже є старий data/ehatynka.db (наприклад, з
// попереднього запуску) — видали цей файл перед першим запуском з
// новою схемою, інакше нові стовпці (role, expires_at) просто не
// з'являться, бо таблиці users/sessions вже "IF NOT EXISTS".
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT,
    provider_token TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    weight TEXT,
    shelf_life_days INTEGER,
    storage_conditions TEXT,
    calories REAL,
    proteins REAL,
    fats REAL,
    carbohydrates REAL,
    price REAL NOT NULL,
    discount_percent REAL NOT NULL DEFAULT 0,
    image_url TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    payment_method_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    total_amount REAL NOT NULL,
    delivery_address TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price_at_purchase REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- Гостьовий кошик живе на session_token, залогинений — на user_id;
  -- UNIQUE на кожному з них окремо (SQLite дозволяє скільки завгодно
  -- NULL-рядків в UNIQUE-індексі, тож гості одне одному не заважають,
  -- а от два кошики на одного user_id/session_token вже не створити).
  CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    session_token TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id),
    UNIQUE (session_token)
  );

  -- user_id тут навмисно ПРИБРАНО (був у першій версії ER-діаграми) —
  -- належність кошика юзеру/гостю визначається виключно через
  -- cart_id -> carts, інакше гостьовий кошик (без user_id) не міг би
  -- мати товарів.
  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL,
    FOREIGN KEY (cart_id) REFERENCES carts(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE (cart_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS wishlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE (user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS ingredient_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_type_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock_quantity REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL,
    FOREIGN KEY (ingredient_type_id) REFERENCES ingredient_types(id)
  );

  -- Норма витрати: скільки ingredient_id має йти на один product_id.
  -- Фактичне списання при виробництві — окремо, в ingredient_movements.
  CREATE TABLE IF NOT EXISTS product_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
    UNIQUE (product_id, ingredient_id)
  );

  -- Журнал фактичних рухів складу: 'restock' (закупівля), 'production'
  -- (списано на випічку продукту — тоді product_id заповнений),
  -- 'waste' (списання браку), 'adjustment' (ручне коригування) тощо.
  -- product_id NULL для рухів, не пов'язаних із конкретним продуктом
  -- (наприклад закупівля чи брак сировини самої по собі).
  CREATE TABLE IF NOT EXISTS ingredient_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL,
    product_id INTEGER,
    movement_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    comment TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- "Не хочу продукти з такими інгредієнтами в каталозі/рекомендаціях"
  -- на рівні ТИПУ інгредієнта (алергії/дієтичні обмеження), не
  -- конкретного інгредієнта — так і задумано.
  CREATE TABLE IF NOT EXISTS user_ingredient_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ingredient_type_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (ingredient_type_id) REFERENCES ingredient_types(id),
    UNIQUE (user_id, ingredient_type_id)
  );
`);

// ---- Паролі: node:crypto scrypt, вбудований у Node, без npm-залежностей.
// Це справжнє, криптографічно стійке хешування (на відміну від
// попереднього fakeHash для localStorage-мока) — з випадковою сіллю на
// кожен пароль і timing-safe порівнянням при перевірці.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Адмін-акаунт: сідиться сам собою при першому запуску (якщо ще
// нема жодного юзера з role='admin') — щоб можна було зайти в
// /admin.html одразу, без ручної реєстрації.
// Логін: "admin", пароль: "pass" (спецкейс і на клієнті — auth-modal.ts,
// і тут нижче в /api/login — email-формат для цього логіна не потрібен).
function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (existing) return;

  const id = `u_admin_${crypto.randomBytes(4).toString("hex")}`;
  db.prepare(
    "INSERT INTO users (id, full_name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?)"
  ).run(id, "Адміністратор", "admin@ehatynka.local", "+000000000", hashPassword("pass"), Date.now());
  console.log('Створено акаунт адміністратора — логін "admin", пароль "pass"');
}
seedAdmin();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,13}$/;

function toSessionUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email, role: row.role };
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 днів — те саме, що maxAge кукі нижче

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) || null;
}

const COOKIE_NAME = "ehatynka_session";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  maxAge: SESSION_TTL_MS, // ті самі 30 днів, що й expires_at у sessions
};

const app = express();
// Ліміт підняно з дефолтних 100kb — іконки категорій летять сюди ж, у
// вигляді base64 у JSON-тілі (дивись /api/admin/upload-icon нижче).
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

app.post("/api/register", (req, res) => {
  const { fullName, email, phone, password } = req.body || {};

  if (typeof fullName !== "string" || fullName.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть ім'я та прізвище" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.json({ ok: false, error: "Введіть коректний email" });
  }
  if (typeof phone !== "string" || !PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
    return res.json({ ok: false, error: "Введіть коректний номер телефону" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.json({ ok: false, error: "Пароль має містити щонайменше 6 символів" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.json({ ok: false, error: "Ця email-адреса вже зареєстрована" });
  }

  const id = `u_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const trimmedName = fullName.trim();

  db.prepare(
    "INSERT INTO users (id, full_name, email, phone, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, trimmedName, normalizedEmail, phone.trim(), hashPassword(password), Date.now());

  const token = createSession(id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: { id, fullName: trimmedName, email: normalizedEmail } });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Спецкейс: логін "admin" (без email-формату) — шукаємо сідованого
  // адміна за role, а не за email (клієнт теж пропускає EMAIL_RE-перевірку
  // саме для цього значення — дивись auth-modal.ts).
  let user;
  if (normalizedEmail === "admin") {
    user = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  } else {
    if (!EMAIL_RE.test(normalizedEmail)) {
      return res.json({ ok: false, error: "Неправильний email або пароль" });
    }
    user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.json({ ok: false, error: "Неправильний email або пароль" });
  }

  const token = createSession(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, user: toSessionUser(user) });
});

app.get("/api/session", (req, res) => {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  res.json({ user: user ? toSessionUser(user) : null });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ==============================
// Категорії
// ==============================

function requireAdmin(req, res, next) {
  const user = getUserByToken(req.cookies[COOKIE_NAME]);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Доступ лише для адміністратора" });
  }
  req.adminUser = user;
  next();
}

function toCategory(row) {
  return { id: row.id, name: row.name, description: row.description, iconUrl: row.icon_url };
}

// Регістронезалежна перевірка на дубль назви — "Хліб" і "хліб" мають
// вважатись однією й тією самою категорією. excludeId — щоб при
// редагуванні категорія не конфліктувала сама з собою.
function findCategoryByName(name, excludeId) {
  const rows = db.prepare("SELECT * FROM categories").all();
  const normalized = name.trim().toLowerCase();
  return rows.find((r) => r.id !== excludeId && r.name.trim().toLowerCase() === normalized) || null;
}

// Публічний список — саме його показує сайдбар категорій покупцю,
// тож усе, що адмін додасть нижче через /api/admin/categories, одразу
// стає видимим і в каталозі.
app.get("/api/categories", (req, res) => {
  const rows = db.prepare("SELECT * FROM categories ORDER BY id ASC").all();
  res.json({ categories: rows.map(toCategory) });
});

app.post("/api/admin/categories", requireAdmin, (req, res) => {
  const { name, description, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву категорії (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findCategoryByName(trimmedName, null)) {
    return res.json({ ok: false, error: "Категорія з такою назвою вже існує" });
  }

  const trimmedDescription =
    typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
  const trimmedIconUrl =
    typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  const result = db
    .prepare("INSERT INTO categories (name, description, icon_url) VALUES (?, ?, ?)")
    .run(trimmedName, trimmedDescription, trimmedIconUrl);

  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ok: true, category: toCategory(row) });
});

app.put("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id категорії" });
  }

  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Категорію не знайдено" });
  }

  const { name, description, iconUrl } = req.body || {};

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.json({ ok: false, error: "Введіть назву категорії (мінімум 2 символи)" });
  }

  const trimmedName = name.trim();

  if (findCategoryByName(trimmedName, id)) {
    return res.json({ ok: false, error: "Категорія з такою назвою вже існує" });
  }

  const trimmedDescription =
    typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
  const trimmedIconUrl =
    typeof iconUrl === "string" && iconUrl.trim().length > 0 ? iconUrl.trim() : null;

  // Іконку замінили (чи прибрали) — старий завантажений файл більше
  // нікому не потрібен, приберемо, щоб assets не засмічувались.
  if (existing.icon_url && existing.icon_url !== trimmedIconUrl) {
    deleteOwnedIconFile(existing.icon_url);
  }

  db.prepare("UPDATE categories SET name = ?, description = ?, icon_url = ? WHERE id = ?").run(
    trimmedName,
    trimmedDescription,
    trimmedIconUrl,
    id
  );

  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  res.json({ ok: true, category: toCategory(row) });
});

app.delete("/api/admin/categories/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.json({ ok: false, error: "Некоректний id категорії" });
  }

  const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "Категорію не знайдено" });
  }

  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  deleteOwnedIconFile(existing.icon_url);

  res.json({ ok: true });
});

// ==============================
// Завантаження іконки категорії.
//
// Без multer (щоб не тягнути ще одну залежність): клієнт сам читає
// обраний файл у base64 (FileReader.readAsDataURL) і шле звичайним
// JSON-POST. Тут — декодуємо назад у Buffer і кладемо файл у
// assets/icons/categories/, з новим безпечним ім'ям (не довіряємо
// оригінальному імені файлу від клієнта).
// ==============================

const CATEGORY_ICON_DIR = path.join(__dirname, "assets", "icons", "categories");
const CATEGORY_ICON_URL_PREFIX = "assets/icons/categories/";
const MAX_ICON_BYTES = 3 * 1024 * 1024; // 3MB — з запасом для іконки

const ICON_MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

// Прибираємо файл іконки лише якщо він лежить у "нашій" папці
// (assets/icons/categories) — щоб не видалити щось за довільним
// зовнішнім посиланням, яке хтось міг вписати вручну через API напряму.
function deleteOwnedIconFile(iconUrl) {
  if (typeof iconUrl !== "string" || !iconUrl.startsWith(CATEGORY_ICON_URL_PREFIX)) return;
  try {
    fs.unlinkSync(path.join(__dirname, iconUrl));
  } catch {
    // Файла вже нема (чи ще щось) — це best-effort прибирання, не критично.
  }
}

app.post("/api/admin/upload-icon", requireAdmin, (req, res) => {
  const { mimeType, dataBase64 } = req.body || {};

  const ext = ICON_MIME_TO_EXT[mimeType];
  if (!ext) {
    return res.json({ ok: false, error: "Непідтримуваний формат (потрібен PNG, JPG, WEBP, GIF або SVG)" });
  }

  if (typeof dataBase64 !== "string" || dataBase64.length === 0) {
    return res.json({ ok: false, error: "Файл порожній" });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return res.json({ ok: false, error: "Не вдалось прочитати файл" });
  }

  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) {
    return res.json({ ok: false, error: "Файл завеликий (максимум 3MB)" });
  }

  fs.mkdirSync(CATEGORY_ICON_DIR, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(CATEGORY_ICON_DIR, filename), buffer);

  res.json({ ok: true, url: `${CATEGORY_ICON_URL_PREFIX}${filename}` });
});

// ==============================
// Панель адміна: плитки таблиць з кількістю записів.
// Список назв — білий список (рівно ті самі таблиці, що в CREATE TABLE
// вище), не приймається ззовні — жодного SQL-інʼєкшену через ${table}.
// ==============================

const ADMIN_TABLES = [
  "users",
  "sessions",
  "payment_methods",
  "orders",
  "order_items",
  "products",
  "categories",
  "carts",
  "cart_items",
  "wishlists",
  "ingredient_types",
  "ingredients",
  "product_recipes",
  "ingredient_movements",
  "user_ingredient_preferences",
];

app.get("/api/admin/table-counts", requireAdmin, (req, res) => {
  const counts = {};
  for (const table of ADMIN_TABLES) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  res.json({ ok: true, counts });
});

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
