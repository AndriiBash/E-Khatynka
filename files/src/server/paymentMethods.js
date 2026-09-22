// ==============================
// Способи оплати — спільні константи. PAYMENT_METHOD_DEFAULT_LABEL
// потрібен і routes/auth.js (кожному новому покупцю одразу заводиться
// "Готівка кур'єру"), і routes/paymentMethods.js.
// ==============================

const PAYMENT_METHOD_TYPES = new Set(["card", "apple_pay", "google_pay", "cash"]);

// Дефолтна назва, коли покупець не вписав свою — той самий текст, що
// й у адмінському PAYMENT_METHOD_TYPE_LABELS в admin.ts, тримаємо
// окремо тут, бо це різні шари (сервер / клієнт).
const PAYMENT_METHOD_DEFAULT_LABEL = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  cash: "Готівка кур'єру",
};

function toAdminPaymentMethod(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userFullName: row.user_full_name,
    userEmail: row.user_email,
    type: row.type,
    label: row.label,
    isDefault: !!row.is_default,
    createdAt: row.created_at,
  };
}

module.exports = { PAYMENT_METHOD_TYPES, PAYMENT_METHOD_DEFAULT_LABEL, toAdminPaymentMethod };
