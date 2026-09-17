// ==============================
// Товари тепер реально живуть у БД (таблиця products, керується з
// admin.html) — той самий підхід, що вже застосований до категорій
// (getCategories() в storage.ts/catalog.ts). PRODUCTS лишається
// експортованим МАСИВОМ (не проміс, не функція), щоб решта коду
// (catalog.ts/product-page.ts/user-menu.ts) не переписувалась —
// loadProducts() просто наповнює цей самий масив на місці (.splice, а
// не переприсвоєння), тож усі наявні PRODUCTS.find(...)/.filter(...)
// продовжують працювати як і раніше, щойно виклик loadProducts()
// зроблено й дочекано хоч один раз.
// ==============================

export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  category: string;
  emoji: string;
  imageUrl: string | null;
  weight: string;
  description: string;
  shelfLife: string;
  manufacturer: string;
}

interface ApiPublicProduct {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  weight: string | null;
  shelfLifeDays: number | null;
  storageConditions: string | null;
  price: number;
  originalPrice: number;
  discountPercent: number;
  imageUrl: string | null;
  stockQuantity: number;
  tagIds: number[];
}

// Немає власної іконки/фото в адмінці — товар все одно має щось
// показати на картці замість порожнього прямокутника.
const FALLBACK_EMOJI = "🍞";

function shelfLifeText(p: ApiPublicProduct): string {
  const parts: string[] = [];
  if (p.shelfLifeDays !== null) {
    parts.push(`${p.shelfLifeDays} дн.`);
  }
  if (p.storageConditions) {
    parts.push(p.storageConditions);
  }
  return parts.length ? parts.join(", ") : "Термін придатності уточнюйте у продавця";
}

function mapApiProduct(p: ApiPublicProduct): Product {
  return {
    id: String(p.id),
    name: p.name,
    price: p.price,
    originalPrice: p.originalPrice,
    discountPercent: p.discountPercent,
    // String(categoryId) — той самий формат, що catalog.ts використовує
    // для activeCategory (порівнює з String(c.id) з /api/categories),
    // тож фільтр за категорією працює без додаткових перетворень.
    category: String(p.categoryId),
    emoji: FALLBACK_EMOJI,
    imageUrl: p.imageUrl,
    weight: p.weight ?? "",
    description: p.description ?? "",
    shelfLife: shelfLifeText(p),
    manufacturer: "Є-Хатинка, Україна",
  };
}

export const PRODUCTS: Product[] = [];

let loadPromise: Promise<void> | null = null;

// Викликається (і чекається) на вході catalog.ts/product-page.ts/
// user-menu.ts (список бажаного) — повторні виклики повертають той
// самий проміс, що вже в польоті чи вже завершився, тож саме
// завантаження відбувається один раз за сесію сторінки.
export function loadProducts(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const res = await fetch("/api/products");
        if (!res.ok) return;
        const data = (await res.json()) as { products?: ApiPublicProduct[] };
        const items = (data.products ?? []).map(mapApiProduct);
        PRODUCTS.splice(0, PRODUCTS.length, ...items);
      } catch {
        // Мовчки лишаємо PRODUCTS порожнім — рендер просто покаже
        // порожній каталог замість падіння сторінки.
      }
    })();
  }
  return loadPromise;
}
