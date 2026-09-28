// ==============================
// Персональні рекомендації для каталогу (лише авторизований покупець).
// Сервер (/api/recommendations) віддає для кожного рекомендованого
// товару причину: "bought" — користувач уже брав його раніше,
// "others" — новий для нього, але його беруть схожі покупці. Тут — лише
// кеш і підписи; сама логіка ранжування — на сервері.
// ==============================

import { getMyRecommendations } from "./storage.js";
import type { RecommendationReason } from "./types.js";

export interface Recommendation {
  reason: RecommendationReason;
  // Порядок у відповіді сервера (0 = найрелевантніший у своїй групі).
  rank: number;
}

export const RECOMMENDATION_LABELS: Record<RecommendationReason, string> = {
  bought: "Ви брали раніше",
  others: "Це беруть також інші",
};

// Ключ — id товару (рядком, як Product.id у products.ts).
let cache = new Map<string, Recommendation>();

export async function loadRecommendations(): Promise<void> {
  const list = await getMyRecommendations();
  const next = new Map<string, Recommendation>();
  list.forEach((r, index) => next.set(String(r.productId), { reason: r.reason, rank: index }));
  cache = next;
}

export function resetRecommendations(): void {
  cache = new Map();
}

export function getRecommendation(productId: string): Recommendation | undefined {
  return cache.get(productId);
}

export function hasRecommendations(): boolean {
  return cache.size > 0;
}
