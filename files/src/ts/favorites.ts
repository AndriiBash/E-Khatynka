// ==============================
// "Обране" — поки просто localStorage (прив'язане до пристрою/браузера,
// не до акаунта на сервері). Коли з'явиться реальний бекенд для цього —
// заміниться на /api/favorites за тим самим принципом, що storage.ts.
// ==============================

const STORAGE_KEY = "ehatynka_favorites";

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeFavorites(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage недоступний (приватний режим тощо) — мовчки ігноруємо,
    // це некритична фіча.
  }
}

export function isFavorite(id: string): boolean {
  return readFavorites().has(id);
}

// Повертає новий стан (true = додано в обране, false = прибрано).
export function toggleFavorite(id: string): boolean {
  const favs = readFavorites();
  const next = !favs.has(id);
  if (next) {
    favs.add(id);
  } else {
    favs.delete(id);
  }
  writeFavorites(favs);
  return next;
}
