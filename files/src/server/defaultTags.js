// ==============================
// Стартові вподобання для нового користувача. Поки в людини немає
// історії покупок, рекомендації "холодні" — тож при реєстрації
// записуємо їй як бажані найпопулярніші теги магазину. Вона може
// будь-коли змінити їх у "Моїх вподобаннях".
//
// Популярність тега = скільки штук товарів із цим тегом уже куплено
// (order_items). Якщо замовлень ще нема, тегів порівну — тоді беремо ті,
// що вішаються на найбільшу кількість товарів у каталозі.
// ==============================

const { db } = require("./db");

const DEFAULT_TAGS_COUNT = 3;

function getPopularTagIds(limit = DEFAULT_TAGS_COUNT) {
  return db
    .prepare(
      `SELECT t.id AS id,
              COALESCE(SUM(oi.quantity), 0) AS sold,
              COUNT(DISTINCT pt.product_id) AS products_count
       FROM tags t
       JOIN product_tags pt ON pt.tag_id = t.id
       LEFT JOIN order_items oi ON oi.product_id = pt.product_id
       GROUP BY t.id
       ORDER BY sold DESC, products_count DESC, t.id ASC
       LIMIT ?`
    )
    .all(limit)
    .map((r) => r.id);
}

function assignDefaultTags(userId) {
  const now = Date.now();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_tag_preferences (user_id, tag_id, created_at) VALUES (?, ?, ?)"
  );
  for (const tagId of getPopularTagIds()) {
    insert.run(userId, tagId, now);
  }
}

module.exports = { assignDefaultTags, getPopularTagIds, DEFAULT_TAGS_COUNT };
