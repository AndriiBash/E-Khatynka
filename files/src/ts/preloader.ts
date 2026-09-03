// ==============================
// Прелоадер: показується одразу (лежить в HTML як overlay),
// ховається після того, як сторінка готова показати контент.
// Мінімальний час показу — щоб анімація не "блимала" на швидких з'єднаннях.
// ==============================

const MIN_VISIBLE_MS = 500;
let shownAt = 0;

export function initPreloader(): void {
  shownAt = Date.now();
}

export function hidePreloader(): void {
  const overlay = document.getElementById("preloader");
  if (!overlay) return;

  const elapsed = Date.now() - shownAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

  window.setTimeout(() => {
    overlay.classList.add("preloader--hidden");
    // Не покладаємось лише на transitionend (може не спрацювати, якщо
    // CSS ще не встиг застосуватись) — прибираємо оверлей і напряму,
    // з невеликим запасом часу, що відповідає тривалості transition.
    window.setTimeout(() => overlay.remove(), 400);
  }, wait);
}
