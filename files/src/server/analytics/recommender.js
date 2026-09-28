// ==============================
// Гібридна рекомендаційна система для авторизованого покупця.
//
//   score(u, j) = wCF·CF(u, j) + wCB·CB(u, j) + wPop·Pop(j)
//
//   CF  — item-based колаборативна фільтрація: наскільки товар j схожий
//         (косинус за векторами покупців) на те, що вже брав u;
//   CB  — контентна фільтрація: косинус між профілем смаків u і вектором
//         товару j (категорія + теги + склад із рецепта, зважені IDF);
//         улюблені теги з «Вподобань» додаються до профілю;
//   Pop — популярність (кількість покупців), вирішує «холодний старт».
//
// Результат — два списки з підписами для каталогу:
//   bought  → «Ви брали раніше»      (те, що користувач уже купував)
//   others  → «Це беруть також інші» (нові для нього, але релевантні)
// ==============================

const { CONFIG } = require("./config");
const { DAY_MS } = require("./stats");

// ---------- Завантаження

function loadRecoData(db) {
  const products = db.prepare("SELECT id, category_id, price, stock_quantity FROM products").all();

  const tagsOf = new Map();
  for (const r of db.prepare("SELECT product_id, tag_id FROM product_tags").all()) {
    if (!tagsOf.has(r.product_id)) tagsOf.set(r.product_id, []);
    tagsOf.get(r.product_id).push(r.tag_id);
  }
  const ingredientsOf = new Map();
  for (const r of db.prepare("SELECT product_id, ingredient_id FROM product_recipes").all()) {
    if (!ingredientsOf.has(r.product_id)) ingredientsOf.set(r.product_id, []);
    ingredientsOf.get(r.product_id).push(r.ingredient_id);
  }

  const purchaseRows = db
    .prepare(
      `SELECT o.id AS order_id, o.user_id AS user_id, oi.product_id AS product_id, oi.quantity AS qty, o.created_at AS ts
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled'`
    )
    .all();

  const wishlist = new Map();
  for (const r of db.prepare("SELECT user_id, product_id FROM wishlists").all()) {
    if (!wishlist.has(r.user_id)) wishlist.set(r.user_id, new Set());
    wishlist.get(r.user_id).add(r.product_id);
  }
  const tagPrefs = new Map();
  for (const r of db.prepare("SELECT user_id, tag_id FROM user_tag_preferences").all()) {
    if (!tagPrefs.has(r.user_id)) tagPrefs.set(r.user_id, new Set());
    tagPrefs.get(r.user_id).add(r.tag_id);
  }

  return { products, tagsOf, ingredientsOf, purchaseRows, wishlist, tagPrefs };
}

// Рядки замовлень → purchases: Map<userId, Map<productId, {qty, last}>>
function aggregatePurchases(rows) {
  const purchases = new Map();
  for (const r of rows) {
    let u = purchases.get(r.user_id);
    if (!u) purchases.set(r.user_id, (u = new Map()));
    const cur = u.get(r.product_id);
    if (cur) {
      cur.qty += r.qty;
      cur.last = Math.max(cur.last, r.ts);
    } else {
      u.set(r.product_id, { qty: r.qty, last: r.ts });
    }
  }
  return purchases;
}

// ---------- Модель

const implicitWeight = (qty) => 1 + Math.log(Math.max(1, qty));

function l2normalize(map) {
  let s = 0;
  for (const v of map.values()) s += v * v;
  const norm = Math.sqrt(s);
  if (norm > 0) for (const [k, v] of map) map.set(k, v / norm);
  return map;
}

function cosineSparse(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w !== undefined) dot += v * w;
  }
  return dot;
}

function buildModel(data, purchases = aggregatePurchases(data.purchaseRows), cfg = CONFIG.reco) {
  const { products, tagsOf, ingredientsOf } = data;
  const byId = new Map(products.map((p) => [p.id, p]));

  // ---- Контентні вектори (TF-IDF по категорії/тегах/складу/ціновому сегменту)
  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length / 3)] ?? 0;
  const q2 = prices[Math.floor((2 * prices.length) / 3)] ?? 0;
  const features = new Map();
  const df = new Map();
  for (const p of products) {
    const f = new Set();
    f.add(`c:${p.category_id}`);
    for (const t of tagsOf.get(p.id) ?? []) f.add(`t:${t}`);
    for (const i of ingredientsOf.get(p.id) ?? []) f.add(`i:${i}`);
    f.add(p.price <= q1 ? "p:low" : p.price <= q2 ? "p:mid" : "p:high");
    features.set(p.id, f);
    for (const k of f) df.set(k, (df.get(k) ?? 0) + 1);
  }
  const N = products.length;
  const idf = (k) => Math.log(1 + N / (df.get(k) ?? 1));
  const contentVec = new Map();
  for (const p of products) {
    const v = new Map();
    for (const k of features.get(p.id)) v.set(k, idf(k) * (cfg.contentGroupWeights[k[0]] ?? 1));
    contentVec.set(p.id, l2normalize(v));
  }

  // ---- CF: вектор товару = покупці з вагою; косинус між товарами
  const itemUsers = new Map(products.map((p) => [p.id, new Map()]));
  for (const [userId, items] of purchases) {
    for (const [pid, info] of items) itemUsers.get(pid)?.set(userId, implicitWeight(info.qty));
  }
  for (const v of itemUsers.values()) l2normalize(v);

  const buyers = new Map();
  let maxBuyers = 0;
  for (const p of products) {
    const c = itemUsers.get(p.id).size;
    buyers.set(p.id, c);
    maxBuyers = Math.max(maxBuyers, c);
  }

  return { data, byId, purchases, contentVec, itemUsers, buyers, maxBuyers, idf };
}

// ---------- Рекомендації для одного користувача

function recommendForUser(model, userId, now = Date.now(), cfg = CONFIG.reco) {
  const { data, byId, purchases, contentVec, itemUsers, buyers, maxBuyers } = model;
  const mine = purchases.get(userId) ?? new Map();
  const wish = data.wishlist.get(userId) ?? new Set();
  const prefTags = data.tagPrefs.get(userId) ?? new Set();

  // ---- 1) «Ви брали раніше» — за частотою з поправкою на давність
  const bought = [];
  for (const [pid, info] of mine) {
    // Товару, якого немає на складі, в каталозі не видно (див. catalog.ts),
    // тож підпис для нього нікуди не потрапить — але забирав би слот зі
    // спискy maxBought. Відкидаємо одразу.
    if (!byId.has(pid) || byId.get(pid).stock_quantity <= 0) continue;
    const ageDays = Math.max(0, (now - info.last) / DAY_MS);
    const score = implicitWeight(info.qty) * Math.pow(0.5, ageDays / cfg.recencyHalfLifeDays);
    bought.push({ productId: pid, score });
  }
  bought.sort((a, b) => b.score - a.score);

  // ---- 2) Профіль смаків: покупки + слабший сигнал зі списку бажаного
  const profile = new Map();
  const addToProfile = (pid, w) => {
    const v = contentVec.get(pid);
    if (!v) return;
    for (const [k, x] of v) profile.set(k, (profile.get(k) ?? 0) + w * x);
  };
  for (const [pid, info] of mine) addToProfile(pid, implicitWeight(info.qty));
  for (const pid of wish) if (!mine.has(pid)) addToProfile(pid, cfg.wishlistWeight);
  l2normalize(profile);
  for (const t of prefTags) profile.set(`t:${t}`, (profile.get(`t:${t}`) ?? 0) + cfg.preferredTagWeight);
  l2normalize(profile);
  const hasProfile = profile.size > 0;

  // ---- 3) Кандидати «Це беруть також інші»: нові для користувача товари,
  //         які реально хтось інший купував (інакше підпис був би неправдою)
  const candidates = [];
  let wSum = 0;
  for (const [, info] of mine) wSum += implicitWeight(info.qty);

  for (const p of data.products) {
    if (mine.has(p.id)) continue;
    if (p.stock_quantity <= 0) continue; // в каталозі такий товар не показується
    const otherBuyers = buyers.get(p.id);
    if (!otherBuyers) continue;

    let cf = 0;
    if (wSum > 0) {
      for (const [pid, info] of mine) {
        cf += implicitWeight(info.qty) * cosineSparse(itemUsers.get(pid), itemUsers.get(p.id));
      }
      cf /= wSum;
    }
    const cb = hasProfile ? cosineSparse(profile, contentVec.get(p.id)) : 0;
    const pop = maxBuyers > 0 ? Math.log(1 + otherBuyers) / Math.log(1 + maxBuyers) : 0;
    // Прямий збіг із тегами, які користувач САМ обрав у профілі: частка
    // його улюблених тегів, що є в товару (0..1). Окремий сигнал, а не
    // лише домішка до контентного профілю — у профілі вони тонули б
    // серед сотень покупок (див. коментар до weightTag в config.js).
    let tagMatch = 0;
    if (prefTags.size > 0) {
      const own = data.tagsOf.get(p.id);
      if (own) {
        let hit = 0;
        for (const t of prefTags) if (own.includes(t)) hit++;
        tagMatch = hit / prefTags.size;
      }
    }
    candidates.push({ productId: p.id, cf, cb, pop, tagMatch, inStock: true });
  }

  // Min-max нормалізація складових до [0, 1] серед кандидатів: інакше
  // майже однакові (але ненульові) косинуси виглядали б «сильним
  // сигналом» після ділення на максимум.
  const range = (key) => {
    const vals = candidates.map((c) => c[key]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return { lo, span: hi - lo };
  };
  const rCF = range("cf");
  const rCB = range("cb");
  const norm = (v, r) => (r.span > 1e-9 ? (v - r.lo) / r.span : 0);
  for (const c of candidates) {
    c.cfN = norm(c.cf, rCF);
    c.cbN = norm(c.cb, rCB);
    let s = cfg.weightCF * c.cfN + cfg.weightCB * c.cbN + cfg.weightPop * c.pop;
    // Якщо користувач обрав улюблені теги — вони отримують окрему частку
    // (weightTag) підсумкового рейтингу, решта складових стискаються
    // пропорційно. Без обраних тегів формула лишається як була.
    if (prefTags.size > 0) s = (1 - cfg.weightTag) * s + cfg.weightTag * c.tagMatch;
    if (!c.inStock) s *= cfg.outOfStockFactor;
    c.score = s;
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    bought: bought.slice(0, cfg.maxBought),
    others: candidates.slice(0, cfg.maxOthers).map((c) => ({
      productId: c.productId,
      score: c.score,
      parts: { cf: c.cfN, cb: c.cbN, pop: c.pop, tag: c.tagMatch },
    })),
  };
}

module.exports = { loadRecoData, aggregatePurchases, buildModel, recommendForUser };
