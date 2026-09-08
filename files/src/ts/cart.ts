// ==============================
// Кошик: наразі проста реактивна модель у пам'яті (без збереження між
// перезавантаженнями сторінки — це майбутній крок, разом з переносом
// на backend, аналогічно до того, як auth переїхав з localStorage на
// /api/*, див. storage.ts).
// ==============================

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  emoji: string;
  qty: number;
}

export interface CartProduct {
  id: string;
  name: string;
  price: number;
  emoji: string;
}

type Listener = (items: CartItem[]) => void;

let items: CartItem[] = [];
const listeners: Listener[] = [];

function notify(): void {
  listeners.forEach((fn) => fn(items));
}

// Викликається одразу при підписці — тож рендер-функції не треба
// окремо запитувати початковий стан.
export function subscribeCart(fn: Listener): void {
  listeners.push(fn);
  fn(items);
}

export function addToCart(product: CartProduct): void {
  const existing = items.find((i) => i.productId === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    items = [
      ...items,
      { productId: product.id, name: product.name, price: product.price, emoji: product.emoji, qty: 1 },
    ];
  }
  notify();
}

export function removeFromCart(productId: string): void {
  items = items.filter((i) => i.productId !== productId);
  notify();
}

export function clearCart(): void {
  items = [];
  notify();
}

export function setQty(productId: string, qty: number): void {
  if (qty <= 0) {
    removeFromCart(productId);
    return;
  }
  items = items.map((i) => (i.productId === productId ? { ...i, qty } : i));
  notify();
}

export function getCartItems(): CartItem[] {
  return items;
}

export function getCartTotal(): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function getCartCount(): number {
  return items.reduce((sum, i) => sum + i.qty, 0);
}
