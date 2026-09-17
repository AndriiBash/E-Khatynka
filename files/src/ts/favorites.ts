// ==============================
// "Обране"/"Список бажаного" тепер реально зберігається в БД (таблиця
// wishlists, keyed by user_id) — раніше жило лише в localStorage.
// Обидва місця використання (product-page.ts — серце на сторінці
// товару, user-menu.ts — попап "Список бажаного") вже гарантовано
// працюють тільки для залогінених (перевірка сесії стоїть ДО виклику),
// тож localStorage більше не потрібен: він однаково "губився" між
// пристроями для того самого акаунта.
// ==============================

let favoriteIds = new Set<string>();
let loadPromise: Promise<void> | null = null;

// Викликається (і чекається) перед першим читанням isFavorite()/
// getFavoriteIds() у сесії, де юзер уже залогінений — так само, як
// loadProducts() у products.ts. Повторні виклики повертають той самий
// проміс, реального повторного запиту не буде.
export function loadFavorites(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch("/api/me/wishlist", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok: boolean; productIds?: number[] };
        favoriteIds = new Set((data.productIds ?? []).map(String));
      } catch {
        // Мовчки лишаємо порожнім — товар просто не покажеться обраним.
      }
    })();
  }
  return loadPromise;
}

// Скидає кеш — потрібно на логауті: інакше після виходу з одного
// акаунта й входу в інший на тій самій вкладці лишався б чужий список.
export function resetFavoritesCache(): void {
  favoriteIds = new Set();
  loadPromise = null;
}

export function isFavorite(id: string): boolean {
  return favoriteIds.has(id);
}

// Список id обраних товарів — для попапу "Список бажаного" в меню
// користувача (user-menu.ts): там треба саме перелік, а не перевірка
// одного конкретного товару, як у isFavorite() вище.
export function getFavoriteIds(): string[] {
  return [...favoriteIds];
}

// Повертає новий стан (true = додано в обране, false = прибрано).
// Оптимістично оновлює локальний кеш одразу — і відкочує його назад,
// якщо сервер відповість помилкою чи запит взагалі не дійде.
export async function toggleFavorite(id: string): Promise<boolean> {
  const next = !favoriteIds.has(id);
  if (next) favoriteIds.add(id);
  else favoriteIds.delete(id);

  try {
    const res = await fetch("/api/me/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ productId: Number(id), enabled: next }),
    });
    const data = (await res.json()) as { ok: boolean };
    if (!data.ok) {
      if (next) favoriteIds.delete(id);
      else favoriteIds.add(id);
    }
  } catch {
    if (next) favoriteIds.delete(id);
    else favoriteIds.add(id);
  }

  return favoriteIds.has(id);
}
