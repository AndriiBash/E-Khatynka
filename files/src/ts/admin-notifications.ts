// ==============================
// Сповіщення адміну про нові замовлення.
//
// Реального push/веб-сокетів у проєкті немає (лише Express + SQLite), тому
// зроблено найпростіший робочий варіант — поллінг: поки відкрита будь-яка
// сторінка admin.html, раз на POLL_INTERVAL_MS питаємо сервер. Відповідь
// містить ДВІ незалежні речі (дивись routes/orders.js):
//   • pendingOrders — УСІ замовлення зі статусом "Очікує обробки" просто
//     зараз. Це і є бейдж/список у панелі — реальний бэклог необроблених
//     замовлень, а не "нове з останнього разу". Так само оновлюється й
//     ЗМЕНШУЄТЬСЯ сам собою, коли адмін обробляє замовлення (змінює
//     статус) — жодного окремого "позначити прочитаним" не потрібно.
//   • orders (нові з afterId) — лише вони показуються як спливна картка
//     + звук: щось з'явилось прямо зараз, поки адмін тут дивиться.
//
// "Останній бачений id" зберігається в localStorage (переживає
// перезавантаження сторінки й спільний для всіх вкладок адмінки), а не в
// пам'яті модуля — інакше після F5 усі старі замовлення знову здавались би
// "новими" (і сипались би тостами повторно).
//
// ВАЖЛИВЕ ОБМЕЖЕННЯ: це саме поллінг, не push. Мобільні браузери (і
// iOS Safari особливо) агресивно призупиняють JS-таймери, коли вкладка
// згорнута/екран заблоковано — доки адмін не поверне вкладку на екран,
// новий заказ фізично не може "дзенькнути". Найкраще, що можна зробити
// без бекенд-push (Service Worker + Push API — окрема, значно важча
// інфраструктура) — одразу перепитати сервер, щойно вкладка знову стала
// видимою (visibilitychange нижче), щоб бэклог наздогнався миттєво, а не
// чекав до наступного 15-секундного тіка.
// ==============================

import { getOrderNotifications } from "./storage.js";
import type { ApiOrderNotification } from "./types.js";

const POLL_INTERVAL_MS = 15000;
const LAST_SEEN_KEY = "ehatynka_admin_last_seen_order_id";
const TOAST_TTL_MS = 12000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let isPolling = false; // проти накладання двох poll(), якщо запит підвис довше 15с

// Поточний бэклог "Очікує обробки" — те, що показує бейдж і панель.
let pendingOrders: ApiOrderNotification[] = [];

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function getLastSeenId(): number {
  const raw = localStorage.getItem(LAST_SEEN_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function setLastSeenId(id: number): void {
  localStorage.setItem(LAST_SEEN_KEY, String(id));
}

function fmtMoney(n: number): string {
  return `${Math.round(n).toLocaleString("uk-UA")} грн`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Короткий "дзвінок" через Web Audio API — два коротких висхідних тони
// (880 Гц → 1180 Гц), без файлу-звуку, який довелось би десь зберігати
// й вантажити.
//
// AudioContext, створений НЕ в обробнику кліку (а тут звук іде з
// setInterval-поллінгу), браузер часто одразу підвішує в стані
// "suspended" — політика проти автозвуку без жесту користувача. Якщо
// створювати новий контекст щоразу під час поллінгу, він так і
// лишається suspended назавжди, і звуку не буде взагалі, хоча помилки
// теж не буде (мовчазний збій). Тому контекст створюємо ОДИН раз і
// "розігріваємо" (resume) на перший клік будь-де на сторінці — на той
// момент, коли реально прийде сповіщення під час відкритої сесії,
// контекст уже в стані "running".
let sharedAudioCtx: AudioContext | null = null;
let audioWarmedUp = false;

function warmUpAudio(): void {
  if (audioWarmedUp) return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  audioWarmedUp = true;
  sharedAudioCtx = new AudioCtx();
  void sharedAudioCtx.resume();
  document.removeEventListener("click", warmUpAudio);
  document.removeEventListener("keydown", warmUpAudio);
}

function beep(): void {
  try {
    const ctx = sharedAudioCtx;
    if (!ctx) return; // ще не було жодного кліку/натискання — почекаємо на наступне сповіщення
    void ctx.resume();
    const playTone = (freq: number, startAt: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startAt + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + 0.3);
    };
    playTone(880, 0);
    playTone(1180, 0.14);
  } catch {
    // Автоплей звуку можуть заблокувати браузерні політики — не критично.
  }
}

function updateBellBadge(): void {
  const count = pendingOrders.length;
  const badge = document.getElementById("admin-notif-badge");
  const sidebarBadge = document.getElementById("admin-orders-nav-badge");
  const mobileMenuBadge = document.getElementById("admin-notif-mobile-badge");
  for (const el of [badge, sidebarBadge, mobileMenuBadge]) {
    if (!el) continue;
    if (count > 0) {
      el.textContent = count > 99 ? "99+" : String(count);
      el.classList.add("admin-notif-badge--visible");
    } else {
      el.textContent = "";
      el.classList.remove("admin-notif-badge--visible");
    }
  }
}

function orderRowHtml(o: ApiOrderNotification): string {
  return `
    <a class="admin-notif__item" href="#/table/orders/${o.id}">
      <span class="admin-notif__item-main">
        <strong>Замовлення №${o.id}</strong>
        <span class="admin-notif__item-sub">${esc(o.userFullName)} · ${o.itemsCount} поз. · ${fmtMoney(o.totalAmount)}</span>
      </span>
      <span class="admin-notif__item-time">${fmtTime(o.createdAt)}</span>
    </a>`;
}

function renderPanel(): void {
  const panel = document.getElementById("admin-notif-panel");
  if (!panel) return;
  panel.innerHTML = pendingOrders.length
    ? pendingOrders.map(orderRowHtml).join("")
    : `<div class="admin-notif__empty">Замовлень, що очікують обробки, немає 🎉</div>`;
}

function showToast(order: ApiOrderNotification): void {
  const host = document.getElementById("admin-notif-toasts");
  if (!host) return;
  const el = document.createElement("a");
  el.className = "admin-toast";
  el.href = `#/table/orders/${order.id}`;
  el.innerHTML = `
    <span class="admin-toast__icon" aria-hidden="true"></span>
    <span class="admin-toast__body">
      <strong>Нове замовлення №${order.id}</strong>
      <span>${esc(order.userFullName)} · ${order.itemsCount} поз. · ${fmtMoney(order.totalAmount)}</span>
    </span>`;
  el.addEventListener("click", () => {
    el.remove();
  });
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("admin-toast--visible"));
  setTimeout(() => {
    el.classList.remove("admin-toast--visible");
    setTimeout(() => el.remove(), 300);
  }, TOAST_TTL_MS);
}

async function poll(isFirstCall: boolean): Promise<void> {
  if (isPolling) return; // попередній запит ще не повернувся — не накладаємось
  isPolling = true;
  try {
    const afterId = getLastSeenId();
    const result = await getOrderNotifications(afterId);
    if (!result.ok) return;

    // Бэклог "Очікує обробки" — завжди актуальний, незалежно від
    // afterId/першого візиту. Саме це показує бейдж і панель.
    pendingOrders = result.pendingOrders;
    updateBellBadge();
    const panel = document.getElementById("admin-notif-panel");
    if (panel?.classList.contains("admin-notif__panel--open")) renderPanel();

    if (afterId === 0) {
      // Перший запуск на цьому пристрої/браузері — не показуємо всю
      // історію як "щойно надійшло", просто запам'ятовуємо поточний
      // максимум. Бэклог pending вище вже показано коректно.
      setLastSeenId(result.maxId);
      return;
    }

    if (result.orders.length > 0) {
      if (!isFirstCall) {
        // Тост+звук — лише коли це "жива" подія під час відкритої
        // сесії, а не історія, яку ми щойно наздогнали після
        // перезавантаження сторінки чи повернення на вкладку.
        for (const order of result.orders) showToast(order);
        beep();
      }
      setLastSeenId(result.maxId);
    }
  } finally {
    isPolling = false;
  }
}

function setPanelOpen(open: boolean): void {
  const panel = document.getElementById("admin-notif-panel");
  const backdrop = document.getElementById("admin-notif-backdrop");
  panel?.classList.toggle("admin-notif__panel--open", open);
  backdrop?.classList.toggle("admin-notif__backdrop--visible", open);
  if (open) renderPanel();
}

// Відкрити панель (завжди примусово, на відміну від кліку на дзвіночок,
// який панель ЩЕ Й перемикає) — викликається і з кліку на сам
// дзвіночок (топбар, десктоп), і з пункту "Сповіщення про замовлення"
// в меню адміна (мобільна адаптація, дивись admin.ts/user-menu.ts):
// там панель подається як звичайна модалка з тьмяним підкладом.
export function openNotificationPanel(): void {
  setPanelOpen(true);
}

function setupBell(): void {
  const bell = document.getElementById("admin-notif-bell");
  const panel = document.getElementById("admin-notif-panel");
  const backdrop = document.getElementById("admin-notif-backdrop");
  const closeBtn = document.getElementById("admin-notif-close");
  if (!bell || !panel) return;

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    setPanelOpen(!panel.classList.contains("admin-notif__panel--open"));
  });

  closeBtn?.addEventListener("click", () => setPanelOpen(false));
  backdrop?.addEventListener("click", () => setPanelOpen(false));

  panel.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement).closest("a.admin-notif__item");
    if (link) setPanelOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("admin-notif__panel--open")) return;
    const target = e.target as Node;
    if (bell.contains(target) || panel.contains(target)) return;
    setPanelOpen(false);
  });
}

// Викликається один раз із render() в admin.ts, після підтвердження, що
// сесія належить адміну.
export function initOrderNotifications(): void {
  if (started) return;
  started = true;
  setupBell();
  document.addEventListener("click", warmUpAudio);
  document.addEventListener("keydown", warmUpAudio);
  void poll(true);
  pollTimer = setInterval(() => void poll(false), POLL_INTERVAL_MS);

  // Мобільний браузер (і не тільки) призупиняє setInterval, поки
  // вкладка згорнута/фонова. Щойно вона знову стала видимою — відразу
  // перепитуємо, а не чекаємо до наступного тіка таймера: без цього
  // адмін, що розблокував телефон і одразу дивиться на екран, ще
  // кілька секунд бачив би застарілий бейдж.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void poll(false);
  });

  window.addEventListener("beforeunload", () => {
    if (pollTimer) clearInterval(pollTimer);
  });
}
