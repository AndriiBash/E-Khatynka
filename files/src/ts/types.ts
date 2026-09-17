// ==============================
// Спільні типи для JSON, який приходить від backend API (server.js).
// ==============================

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface ApiCategory {
  id: number;
  name: string;
  description: string | null;
  iconUrl: string | null;
}

export interface ApiTag {
  id: number;
  name: string;
  iconUrl: string | null;
}

export interface ApiUserTagPreference {
  id: number;
  userId: string;
  userFullName: string;
  userEmail: string;
  tagId: number;
  tagName: string;
  tagIconUrl: string | null;
  createdAt: number;
}

export interface ApiAdminUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  createdAt: number;
  orderCount: number;
  totalSpent: number;
}

export interface ApiAdminSession {
  token: string;
  userId: string;
  userFullName: string;
  userEmail: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApiIngredient {
  id: number;
  name: string;
  unit: string;
  stockQuantity: number;
  lowStockThreshold: number | null;
  iconUrl: string | null;
}

export interface ApiAdminPaymentMethod {
  id: number;
  userId: string;
  userFullName: string;
  userEmail: string;
  type: string;
  label: string | null;
  isDefault: boolean;
  createdAt: number;
}

export interface ApiProductRecipeItem {
  id: number;
  ingredientId: number;
  ingredientName: string;
  ingredientUnit: string;
  quantity: number;
}

export interface ApiProduct {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  weight: string | null;
  shelfLifeDays: number | null;
  storageConditions: string | null;
  calories: number | null;
  proteins: number | null;
  fats: number | null;
  carbohydrates: number | null;
  price: number;
  discountPercent: number;
  imageUrl: string | null;
  stockQuantity: number;
  recipes: ApiProductRecipeItem[];
  tagIds: number[];
}

export interface ApiAdminWishlistItem {
  id: number;
  userId: string;
  userFullName: string;
  userEmail: string;
  productId: number;
  productName: string;
  createdAt: number;
}

export interface ApiAdminCart {
  id: number;
  userId: string | null;
  userFullName: string | null;
  userEmail: string | null;
  isGuest: boolean;
  itemsCount: number;
  createdAt: number;
}

export interface ApiAdminCartItem {
  id: number;
  cartId: number;
  cartOwner: string;
  productId: number;
  productName: string;
  quantity: number;
  addedAt: number;
}

export interface ApiAdminProductRecipeItem {
  id: number;
  productId: number;
  productName: string;
  ingredientId: number;
  ingredientName: string;
  ingredientUnit: string;
  quantity: number;
}

export interface ApiAdminProductTagItem {
  id: number;
  productId: number;
  productName: string;
  tagId: number;
  tagName: string;
}
