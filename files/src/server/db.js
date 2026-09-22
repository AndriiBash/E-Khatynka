// ==============================
// SQLite-з'єднання (вбудований у Node.js модуль node:sqlite — жодних
// зовнішніх БД чи нативних залежностей, які треба було б компілювати
// під платформу), схема БД, міграції під оновлену ER-діаграму й сід
// адмін-акаунта. Усе, що раніше стояло на самому верху server.js.
// ==============================

const path = require("path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { ROOT_DIR } = require("./paths");
const { hashPassword } = require("./password");

const DATA_DIR = path.join(ROOT_DIR, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "ehatynka.db");

const db = new DatabaseSync(DB_PATH);

// Без цього SQLite мовчки ІГНОРУЄ всі FOREIGN KEY — вони в CREATE TABLE
// нижче лише документація, доки не увімкнено явно (за замовчуванням
// вимкнено в самому SQLite, і node:sqlite не вмикає сам).
db.exec("PRAGMA foreign_keys = ON;");

// ---- Міграція під оновлену ER-діаграму (тип-таблиця інгредієнтів
// прибрана, вподобання користувачів тепер по тегах, а не по типу
// інгредієнта) — виконується ДО CREATE TABLE IF NOT EXISTS нижче,
// інакше стара версія цих таблиць просто лишилась би як є.
// Ingredients/ingredient_types/user_ingredient_preferences на бойовій
// базі порожні (склад ще не наповнювали), тож дропаємо без бекапу; але
// про всяк випадок рахуємо рядки й пишемо в консоль, якщо там щось є.
function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
}

if (tableExists("ingredients") && columnExists("ingredients", "ingredient_type_id")) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM ingredients").get();
  if (n > 0) {
    console.warn(
      `Міграція схеми: у старій таблиці ingredients було ${n} рядків з ingredient_type_id — ` +
        "ця колонка прибрана новою ER-діаграмою, дані буде втрачено."
    );
  }
  db.exec("DROP TABLE ingredients;");
}

if (tableExists("ingredient_types")) {
  db.exec("DROP TABLE ingredient_types;");
}

if (tableExists("user_ingredient_preferences")) {
  db.exec("DROP TABLE user_ingredient_preferences;");
}

// Додаємо icon_url до вже існуючої таблиці ingredients (той самий
// принцип, що icon_url у категорій/тегів — посилання на файл в
// assets/icons/ingredients/). CREATE TABLE IF NOT EXISTS нижче не
// зачепить колонки вже існуючої таблиці, тож для баз, створених до
// цієї зміни, додаємо колонку окремо через ALTER TABLE.
if (tableExists("ingredients") && !columnExists("ingredients", "icon_url")) {
  db.exec("ALTER TABLE ingredients ADD COLUMN icon_url TEXT;");
}

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

  -- Оновлена ER-діаграма прибрала "Типи інгредієнтів" як окрему
  -- сутність — обмеження за вподобаннями тепер на рівні тегів (нижче),
  -- а не типу інгредієнта, тож ingredient_type_id тут теж пішов геть.
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock_quantity REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL,
    icon_url TEXT
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

  -- Нове з ER-діаграми: теги (наприклад "гостре", "веганське",
  -- "без глютену") — вішаються на продукти через product_tags і
  -- використовуються у вподобаннях користувачів нижче.
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon_url TEXT
  );

  CREATE TABLE IF NOT EXISTS product_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id),
    UNIQUE (product_id, tag_id)
  );

  -- "Не хочу продукти з таким тегом в каталозі/рекомендаціях" — те
  -- саме, що раніше user_ingredient_preferences, але тепер по tag_id
  -- замість ingredient_type_id (сама ER-діаграма так змінилась).
  CREATE TABLE IF NOT EXISTS user_tag_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id),
    UNIQUE (user_id, tag_id)
  );
`);

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
  "ingredients",
  "product_recipes",
  "ingredient_movements",
  "tags",
  "product_tags",
  "user_tag_preferences",
];

// Не всі таблиці мають колонку часу — там, де немає (products,
// categories, tags, product_tags, ingredients, product_recipes,
// order_items), lastUpdated просто прийде null, і фронтенд це
// врахує (покаже "—" замість дати).
const ADMIN_TABLE_TIMESTAMP_COLUMN = {
  users: "created_at",
  sessions: "created_at",
  payment_methods: "created_at",
  orders: "created_at",
  carts: "created_at",
  cart_items: "added_at",
  wishlists: "created_at",
  ingredient_movements: "created_at",
  user_tag_preferences: "created_at",
};

module.exports = { db, DB_PATH, ADMIN_TABLES, ADMIN_TABLE_TIMESTAMP_COLUMN };
