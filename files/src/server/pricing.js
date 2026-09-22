// ==============================
// Ціна товару з урахуванням знижки — використовується і в публічному
// каталозі (/api/products), і при оформленні замовлення
// (routes/orders.js), тож живе окремо, а не всередині routes/products.js.
// ==============================

function discountedPrice(row) {
  const discountPercent = row.discount_percent || 0;
  return discountPercent > 0 ? Math.round(row.price * (1 - discountPercent / 100) * 100) / 100 : row.price;
}

module.exports = { discountedPrice };
