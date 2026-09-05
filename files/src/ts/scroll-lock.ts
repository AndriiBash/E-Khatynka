// ==============================
// Спільний прийом блокування скролу фону, поки відкрита будь-яка
// модалка/шторка (вхід/реєстрація, кошик на мобілці тощо). Раніше цей
// самий код був продубльований прямо в auth-modal.ts.
// ==============================

let savedScrollY = 0;
let lockDepth = 0;

export function lockScroll(): void {
  // "Глибина" — про всяк випадок, якщо колись відкриються дві шторки
  // одна над одною: перша, що закриється, не повинна розблоковувати
  // скрол, поки відкрита друга.
  if (lockDepth === 0) {
    savedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }
  lockDepth += 1;
}

export function unlockScroll(): void {
  lockDepth = Math.max(0, lockDepth - 1);
  if (lockDepth === 0) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, savedScrollY);
  }
}
