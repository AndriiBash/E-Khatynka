import { registerUser, loginUser, getSession } from "./storage.js";

// ==============================
// Логіка сторінок login.html та register.html
// ==============================

function showFieldError(fieldId: string, message: string): void {
  const field = document.getElementById(fieldId);
  const errorEl = document.getElementById(`${fieldId}-error`);
  if (errorEl) errorEl.textContent = message;
  if (field) field.classList.toggle("input--invalid", message.length > 0);
}

function clearErrors(fieldIds: string[]): void {
  fieldIds.forEach((id) => showFieldError(id, ""));
}

function showFormMessage(message: string, isError: boolean): void {
  const el = document.getElementById("form-message");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("form-message--error", isError);
  el.classList.toggle("form-message--visible", message.length > 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{9,13}$/;

function initRegisterForm(): void {
  const form = document.getElementById("register-form") as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const fullName = (document.getElementById("fullName") as HTMLInputElement).value.trim();
    const email = (document.getElementById("email") as HTMLInputElement).value.trim();
    const phone = (document.getElementById("phone") as HTMLInputElement).value.trim();
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const passwordConfirm = (document.getElementById("passwordConfirm") as HTMLInputElement).value;
    const agree = (document.getElementById("agree") as HTMLInputElement).checked;

    clearErrors(["fullName", "email", "phone", "password", "passwordConfirm", "agree"]);
    let hasError = false;

    if (fullName.length < 2) {
      showFieldError("fullName", "Введіть ім'я та прізвище");
      hasError = true;
    }
    if (!EMAIL_RE.test(email)) {
      showFieldError("email", "Введіть коректний email");
      hasError = true;
    }
    if (!PHONE_RE.test(phone.replace(/[\s()-]/g, ""))) {
      showFieldError("phone", "Введіть коректний номер телефону");
      hasError = true;
    }
    if (password.length < 6) {
      showFieldError("password", "Пароль має містити щонайменше 6 символів");
      hasError = true;
    }
    if (password !== passwordConfirm) {
      showFieldError("passwordConfirm", "Паролі не збігаються");
      hasError = true;
    }
    if (!agree) {
      showFieldError("agree", "Потрібно погодитись з умовами використання");
      hasError = true;
    }

    if (hasError) return;

    const result = registerUser({ fullName, email, phone, password });
    if (!result.ok) {
      showFormMessage(result.error, true);
      return;
    }

    // Кеш-бастинг: деякі мобільні браузери (Safari) при простому
    // location.href = "index.html" іноді віддають сторінку зі свого
    // кешу диска — включно з "порожньою" застарілою версією. Унікальний
    // query-параметр змушує браузер завжди робити свіжий запит.
    window.location.replace(`index.html?_=${Date.now()}`);
  });
}

function initLoginForm(): void {
  const form = document.getElementById("login-form") as HTMLFormElement | null;
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const email = (document.getElementById("email") as HTMLInputElement).value.trim();
    const password = (document.getElementById("password") as HTMLInputElement).value;

    clearErrors(["email", "password"]);
    let hasError = false;

    if (!EMAIL_RE.test(email)) {
      showFieldError("email", "Введіть коректний email");
      hasError = true;
    }
    if (password.length === 0) {
      showFieldError("password", "Введіть пароль");
      hasError = true;
    }
    if (hasError) return;

    const result = loginUser(email, password);
    if (!result.ok) {
      showFormMessage(result.error, true);
      return;
    }

    // Той самий кеш-бастинг, що і в реєстрації — див. коментар вище.
    window.location.replace(`index.html?_=${Date.now()}`);
  });
}

// Якщо користувач вже залогінений — показуємо банер-підказку
function showSessionBanner(): void {
  const banner = document.getElementById("already-logged-in");
  const session = getSession();
  if (session && banner) {
    banner.textContent = `Ви вже увійшли як ${session.fullName}. Перейти на головну →`;
    banner.classList.add("session-banner--visible");
    banner.addEventListener("click", () => {
      window.location.replace(`index.html?_=${Date.now()}`);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initRegisterForm();
  initLoginForm();
  showSessionBanner();
});
