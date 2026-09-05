// ==============================
// Мок-дані каталогу. Пізніше замінюються на реальні запити до backend
// (той самий сервер, що вже роздає /api/register тощо, отримає ще й
// /api/products) — тут просто заглушка, щоб було на чому показати
// макет (категорії зліва, товари по центру, кошик справа).
// ==============================

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  emoji: string;
}

export interface Category {
  id: string;
  name: string;
}

export const CATEGORIES: Category[] = [
  { id: "all", name: "Усі товари" },
  { id: "bread", name: "Хліб" },
  { id: "pastry", name: "Випічка" },
  { id: "cakes", name: "Торти" },
  { id: "drinks", name: "Напої" },
];

export const PRODUCTS: Product[] = [
  { id: "p1", name: "Хліб пшеничний", price: 35, category: "bread", emoji: "🍞" },
  { id: "p2", name: "Хліб житній", price: 38, category: "bread", emoji: "🍞" },
  { id: "p3", name: "Багет французький", price: 42, category: "bread", emoji: "🥖" },
  { id: "p4", name: "Круасан вершковий", price: 45, category: "pastry", emoji: "🥐" },
  { id: "p5", name: "Булочка з корицею", price: 40, category: "pastry", emoji: "🥯" },
  { id: "p6", name: "Пиріжок з вишнею", price: 32, category: "pastry", emoji: "🥟" },
  { id: "p7", name: "Торт Наполеон", price: 320, category: "cakes", emoji: "🍰" },
  { id: "p8", name: "Чізкейк", price: 280, category: "cakes", emoji: "🍮" },
  { id: "p9", name: "Медовик", price: 260, category: "cakes", emoji: "🎂" },
  { id: "p10", name: "Кава американо", price: 55, category: "drinks", emoji: "☕" },
  { id: "p11", name: "Капучино", price: 65, category: "drinks", emoji: "☕" },
  { id: "p12", name: "Морс ягідний", price: 45, category: "drinks", emoji: "🧃" },
];
