// ==============================
// Свайп по "ручці" шторки вниз — закриває її. Спільна логіка для будь-
// якої нижньої шторки на сайті (кошик на мобілці, меню користувача).
// ==============================

const SWIPE_CLOSE_THRESHOLD = 80;

export function setupSwipeToClose(panel: HTMLElement, handle: HTMLElement, onClose: () => void): void {
  let startY = 0;
  let currentY = 0;
  let dragging = false;

  const onTouchStart = (e: TouchEvent): void => {
    dragging = true;
    startY = e.touches[0].clientY;
    currentY = startY;
    panel.classList.add("is-dragging");
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    // Тягнемо панель за пальцем у реальному часі (без transition, щоб не
    // було лагу відносно самого пальця) — рухається тільки вниз.
    const delta = Math.max(0, currentY - startY);
    panel.style.transform = `translateY(${delta}px)`;
  };

  const onTouchEnd = (): void => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("is-dragging");
    const delta = Math.max(0, currentY - startY);
    panel.style.transform = "";
    if (delta > SWIPE_CLOSE_THRESHOLD) {
      onClose();
    }
    // Якщо потягнули замало — просто прибираємо inline-transform, і
    // панель сама "пружинить" назад через звичайний CSS-transition.
  };

  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  handle.addEventListener("touchmove", onTouchMove, { passive: true });
  handle.addEventListener("touchend", onTouchEnd);
  handle.addEventListener("touchcancel", onTouchEnd);
}
