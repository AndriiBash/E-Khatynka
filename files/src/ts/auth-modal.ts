import { registerUser, loginUser } from "./storage.js";
import { lockScroll, unlockScroll } from "./scroll-lock.js";

// ==============================
// Модалка входу/реєстрації (замінює те, що раніше було окремими
// сторінками login.html/register.html — самі файли видалені, тепер це
// тільки модалка на index.html).
// ==============================

type AuthMode = "login" | "register";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,13}$/;

function showFieldError(fieldId: string, message: string): void {
  const field = document.getElementById(fieldId);
  const errorEl = document.getElementById(`${fieldId}-error`);
  if (errorEl) errorEl.textContent = message;
  if (field) field.classList.toggle("input--invalid", message.length > 0);
}

function clearErrors(fieldIds: string[]): void {
  fieldIds.forEach((id) => showFieldError(id, ""));
}

function showFormMessage(elId: string, message: string, isError: boolean): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("form-message--error", isError);
  el.classList.toggle("form-message--visible", message.length > 0);
}

let onAuthSuccess: (() => void) | null = null;

// Викликається з main.ts, щоб після успішного входу/реєстрації одразу
// оновити шапку (ім'я користувача, аватар) без перезавантаження сторінки.
export function setAuthSuccessHandler(handler: () => void): void {
  onAuthSuccess = handler;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeAuthModal();
}

function switchPanel(mode: AuthMode): void {
  const loginPanel = document.getElementById("auth-modal-login");
  const registerPanel = document.getElementById("auth-modal-register");
  if (!loginPanel || !registerPanel) return;

  loginPanel.hidden = mode !== "login";
  registerPanel.hidden = mode !== "register";

  const firstInput = (
    mode === "login"
      ? document.getElementById("modal-login-email")
      : document.getElementById("modal-register-fullName")
  ) as HTMLInputElement | null;
  // Невеликий таймаут — щоб фокус ставився вже після того, як панель
  // стала видимою (display повертається з "none" не миттєво в усіх
  // браузерах в межах того самого мікротаску).
  window.setTimeout(() => firstInput?.focus(), 0);
}

export function openAuthModal(mode: AuthMode = "login"): void {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  switchPanel(mode);
  modal.classList.add("auth-modal--open");
  modal.setAttribute("aria-hidden", "false");
  lockScroll();
  document.addEventListener("keydown", onKeydown);
}

export function closeAuthModal(): void {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  modal.classList.remove("auth-modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.removeEventListener("keydown", onKeydown);
  // Той самий принцип, що й у мобільній шторці кошика (catalog.ts) —
  // не смикати фон назад у скрол, поки сама модалка ще візуально
  // згасає (~0.2s).
  window.setTimeout(() => {
    unlockScroll();
  }, 200);
}

function initLoginForm(): void {
  const form = document.getElementById("modal-login-form") as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      const email = (document.getElementById("modal-login-email") as HTMLInputElement).value.trim();
      const password = (document.getElementById("modal-login-password") as HTMLInputElement).value;

      clearErrors(["modal-login-email", "modal-login-password"]);
      let hasError = false;

      if (!EMAIL_RE.test(email)) {
        showFieldError("modal-login-email", "Введіть коректний email");
        hasError = true;
      }
      if (password.length === 0) {
        showFieldError("modal-login-password", "Введіть пароль");
        hasError = true;
      }
      if (hasError) return;

      const submitBtn = form.querySelector<HTMLButtonElement>("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;

      const result = await loginUser(email, password);

      if (submitBtn) submitBtn.disabled = false;

      if (!result.ok) {
        showFormMessage("modal-login-message", result.error, true);
        return;
      }

      showFormMessage("modal-login-message", "", false);
      form.reset();
      closeAuthModal();
      onAuthSuccess?.();
    })();
  });
}

function initRegisterForm(): void {
  const form = document.getElementById("modal-register-form") as HTMLFormElement | null;
  if (!form) return;

  // Маска номера: фіксований префікс "+380 " + згруповані цифри
  // "XX XXX XX XX" (9 цифр після коду країни — рівно стільки в
  // українському мобільному номері). Разом це завжди відповідає
  // компактному "+380XXXXXXXXX" (13 символів), просто зі зручними
  // проміжками для читання.
  const PHONE_PREFIX = "+380";

  function formatPhoneValue(raw: string): string {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("380")) digits = digits.slice(3);
    digits = digits.slice(0, 9);
    if (digits.length === 0) return `${PHONE_PREFIX} `;
    const parts: string[] = [digits.slice(0, 2)];
    if (digits.length > 2) parts.push(digits.slice(2, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 7));
    if (digits.length > 7) parts.push(digits.slice(7, 9));
    return `${PHONE_PREFIX} ${parts.join(" ")}`;
  }

  const phoneInput = document.getElementById("modal-register-phone") as HTMLInputElement | null;

  phoneInput?.addEventListener("focus", () => {
    if (!phoneInput.value) phoneInput.value = `${PHONE_PREFIX} `;
  });

  phoneInput?.addEventListener("input", () => {
    phoneInput.value = formatPhoneValue(phoneInput.value);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      const fullName = (document.getElementById("modal-register-fullName") as HTMLInputElement).value.trim();
      const email = (document.getElementById("modal-register-email") as HTMLInputElement).value.trim();
      const phone = (document.getElementById("modal-register-phone") as HTMLInputElement).value.trim();
      const password = (document.getElementById("modal-register-password") as HTMLInputElement).value;
      const passwordConfirm = (document.getElementById("modal-register-passwordConfirm") as HTMLInputElement).value;
      const agree = (document.getElementById("modal-register-agree") as HTMLInputElement).checked;

      clearErrors([
        "modal-register-fullName",
        "modal-register-email",
        "modal-register-phone",
        "modal-register-password",
        "modal-register-passwordConfirm",
        "modal-register-agree",
      ]);
      let hasError = false;

      if (fullName.length < 2) {
        showFieldError("modal-register-fullName", "Введіть ім'я та прізвище");
        hasError = true;
      }
      if (!EMAIL_RE.test(email)) {
        showFieldError("modal-register-email", "Введіть коректний email");
        hasError = true;
      }
      if (!PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
        showFieldError("modal-register-phone", "Введіть коректний номер телефону");
        hasError = true;
      }
      if (password.length < 6) {
        showFieldError("modal-register-password", "Пароль має містити щонайменше 6 символів");
        hasError = true;
      }
      if (password !== passwordConfirm) {
        showFieldError("modal-register-passwordConfirm", "Паролі не збігаються");
        hasError = true;
      }
      if (!agree) {
        showFieldError("modal-register-agree", "Потрібно погодитись з умовами використання");
        hasError = true;
      }

      if (hasError) return;

      const submitBtn = form.querySelector<HTMLButtonElement>("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;

      const result = await registerUser({
        fullName,
        email,
        phone: phone.replace(/\s/g, ""),
        password,
      });

      if (submitBtn) submitBtn.disabled = false;

      if (!result.ok) {
        showFormMessage("modal-register-message", result.error, true);
        return;
      }

      showFormMessage("modal-register-message", "", false);
      form.reset();
      closeAuthModal();
      onAuthSuccess?.();
    })();
  });
}

export function setupAuthModal(): void {
  const modal = document.getElementById("auth-modal");
  if (!modal) return;

  initLoginForm();
  initRegisterForm();

  document.getElementById("auth-modal-close")?.addEventListener("click", closeAuthModal);
  document.getElementById("auth-modal-backdrop")?.addEventListener("click", closeAuthModal);

  document.querySelectorAll<HTMLButtonElement>("[data-switch-to]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchPanel(btn.dataset.switchTo === "register" ? "register" : "login");
    });
  });

  // Дозволяє прийти на index.html?auth=login (або ?auth=register) і
  // одразу побачити відкриту модалку — корисно для будь-яких зовнішніх
  // посилань на вхід/реєстрацію (розсилки, старі закладки тощо).
  const params = new URLSearchParams(window.location.search);
  const authParam = params.get("auth");
  if (authParam === "login" || authParam === "register") {
    openAuthModal(authParam);
    params.delete("auth");
    const rest = params.toString();
    const cleanUrl = window.location.pathname + (rest ? `?${rest}` : "");
    window.history.replaceState(null, "", cleanUrl);
  }
}
