// ==============================
// Спільні типи для JSON, який приходить від backend API (server.js).
// ==============================

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
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
  ingredientIconUrl: string | null;
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

export interface ApiAdminCartItemSummary {
  productId: number;
  productName: string;
  quantity: number;
}

export interface ApiAdminCart {
  id: number;
  userId: string | null;
  userFullName: string | null;
  userEmail: string | null;
  isGuest: boolean;
  itemsCount: number;
  createdAt: number;
  items: ApiAdminCartItemSummary[];
}

export interface ApiAdminCartItem {
  id: number;
  cartId: number;
  cartOwner: string;
  cartOwnerEmail: string | null;
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

export interface ApiAdminIngredientMovementItem {
  ingredientId: number;
  ingredientName: string;
  ingredientUnit: string;
  quantity: number;
}

export interface ApiAdminIngredientMovement {
  id: number;
  batchId: string | null;
  ingredientId: number | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  productId: number | null;
  productName: string | null;
  movementType: string;
  quantity: number;
  comment: string | null;
  createdAt: number;
  items: ApiAdminIngredientMovementItem[] | null;
}

export interface ApiAdminProductTagItem {
  id: number;
  productId: number;
  productName: string;
  tagId: number;
  tagName: string;
}

// ---- Замовлення (orders/order_items) ----

export interface ApiOrderItem {
  id: number;
  productId: number;
  productName: string;
  productImageUrl: string | null;
  quantity: number;
  priceAtPurchase: number;
}

// Замовлення покупця — і те, що бачить сам покупець у "Мої замовлення"
// (без чужих userId/email), і основа для адмінського рядка нижче.
export interface ApiOrder {
  id: number;
  status: string;
  totalAmount: number;
  deliveryAddress: string;
  contactPhone: string;
  createdAt: number;
  items: ApiOrderItem[];
}

export interface ApiAdminOrder extends ApiOrder {
  userId: string;
  userFullName: string;
  userEmail: string;
  itemsCount: number;
}

export interface ApiAdminOrderItem {
  id: number;
  orderId: number;
  orderOwner: string;
  orderOwnerEmail: string | null;
  productId: number;
  productName: string;
  quantity: number;
  priceAtPurchase: number;
}

// ---- Аналітика (адмінка) і рекомендації (каталог) ----

export type ForecastConfidence = "high" | "medium" | "low";

export interface ApiForecastRow {
  productId: number;
  name: string;
  categoryId: number;
  categoryName: string;
  perishable: boolean;
  price: number;
  stock: number;
  status: string;
  modelId: string | null;
  modelName: string | null;
  confidence: ForecastConfidence;
  historyDays: number;
  wape: number | null;
  naiveWape: number | null;
  sigma: number;
  // Прогноз середнього попиту на кожен із наступних днів (шт.)
  forecast: number[];
  forecastWeek: number;
  // Фактичні продажі за останні (до) 28 днів
  recent: number[];
}

export interface ApiPlanDay {
  date: string;
  forecast: number;
  target: number;
  produce: number;
  dayparts: Record<string, number>;
}

export interface ApiPlanRow {
  productId: number;
  name: string;
  stock: number;
  perishable: boolean;
  criticalRatio: number;
  days: ApiPlanDay[];
}

export type IngredientNeedStatus = "ok" | "low" | "critical" | "unused";

export interface ApiIngredientNeed {
  ingredientId: number;
  name: string;
  unit: string;
  iconUrl: string | null;
  stock: number;
  perDay: number[];
  needTomorrow: number;
  needWeek: number;
  shortageTomorrow: number;
  shortageWeek: number;
  status: IngredientNeedStatus;
  lowStockThreshold: number | null;
  belowThreshold: boolean;
  usedInRecipes: boolean;
}

export type DiscountStatus = "overstock" | "slow" | "ok";
export type DiscountAction = "apply" | "keep" | "remove" | "none";

export interface ApiDiscountRow {
  productId: number;
  name: string;
  perishable: boolean;
  status: DiscountStatus;
  action: DiscountAction;
  currentDiscount: number;
  suggestedDiscount: number;
  price: number;
  newPrice: number;
  expectedUpliftPct: number;
  reason: string;
  metrics: {
    stock: number;
    shelfLifeDays: number;
    sold7: number;
    sold14: number;
    velocity: number;
    categoryMedian: number;
    relativeVelocity: number;
    forecastDaily: number;
    daysOfCover: number | null;
    excessUnits: number;
    stillExcessUnits: number;
    lifeDays: number;
  };
}

export interface ApiModelSummary {
  id: string;
  name: string;
  wape: number | null;
  chosenCount: number;
}

export interface ApiDaypart {
  id: string;
  label: string;
  from: number;
  to: number;
}

export interface ApiAnalyticsReport {
  generatedAt: number;
  meta: {
    historyDays: number;
    firstDate: string | null;
    lastDate: string | null;
    totalUnits: number;
    horizonDays: number;
    productsTotal: number;
    ingredientsTotal: number;
    perishableMaxShelfDays: number;
    costRatio: number;
    priceElasticity: number;
    dayparts: ApiDaypart[];
    accuracy: {
      wape: number | null;
      naiveWape: number | null;
      totalWape: number | null;
      totalNaiveWape: number | null;
      totalModel: string | null;
    };
    warnings: string[];
  };
  dates: Array<{ iso: string; dow: number }>;
  historyDates: string[];
  totals: {
    history: number[];
    forecast: Array<{ units: number; revenue: number }>;
    produce: Array<{ units: number; dayparts: Record<string, number> }>;
  };
  forecast: ApiForecastRow[];
  plan: ApiPlanRow[];
  ingredients: ApiIngredientNeed[];
  discounts: ApiDiscountRow[];
  models: ApiModelSummary[];
}

export interface ApiOrderNotification {
  id: number;
  userFullName: string;
  totalAmount: number;
  itemsCount: number;
  status: string;
  createdAt: number;
}

export interface OrderNotificationsResult {
  ok: boolean;
  maxId: number;
  orders: ApiOrderNotification[];
  pendingOrders: ApiOrderNotification[];
}

export interface ApiStorefrontHighlights {
  ok: boolean;
  popular: number[];
  promoted: number[];
}

export type RecommendationReason = "bought" | "others";

export interface ApiRecommendation {
  productId: number;
  reason: RecommendationReason;
  score: number;
}
