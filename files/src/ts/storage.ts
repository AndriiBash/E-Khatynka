import type { User, SessionUser } from "./types.js";

// ==============================
// Мок "бази даних" на localStorage.
// Коли з'явиться backend — ці функції заміняться на fetch-виклики до REST API,
// а сигнатури залишаться максимально близькими.
// ==============================

const USERS_KEY = "ehatynka_users";
const SESSION_KEY = "ehatynka_session";

// Спрощене "хешування" лише для прототипу — НЕ використовувати в продакшн.
// Реальний бекенд повинен хешувати паролі через bcrypt/argon2 на сервері.
function fakeHash(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return `h_${hash}_${password.length}`;
}

// Деякі мобільні браузери (Safari у приватному режимі, вбудовані WebView
// у месенджерах з увімкненим "Prevent Cross-Site Tracking" тощо) можуть
// кидати виняток просто при зверненні до localStorage.getItem/setItem,
// а не лише при переповненні квоти. Без try/catch це впало б синхронно
// ще до DOMContentLoaded і зупинило б виконання всього auth.js/main.js.
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ігноруємо — немає що видаляти, якщо сховище недоступне
  }
}

export function isStorageAvailable(): boolean {
  try {
    const testKey = "__ehatynka_storage_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function readUsers(): User[] {
  const raw = safeGetItem(USERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as User[];
  } catch {
    return [];
  }
}

function writeUsers(users: User[]): void {
  safeSetItem(USERS_KEY, JSON.stringify(users));
}

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

export function registerUser(input: RegisterInput): AuthResult {
  if (!isStorageAvailable()) {
    return {
      ok: false,
      error:
        "Не вдалося зберегти дані на цьому пристрої. Вимкніть приватний режим браузера й спробуйте ще раз.",
    };
  }

  const users = readUsers();
  const emailTaken = users.some(
    (u) => u.email.toLowerCase() === input.email.toLowerCase()
  );
  if (emailTaken) {
    return { ok: false, error: "Ця email-адреса вже зареєстрована" };
  }

  const user: User = {
    id: `u_${Date.now()}`,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    passwordHash: fakeHash(input.password),
  };
  users.push(user);
  writeUsers(users);

  const session: SessionUser = {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
  };
  safeSetItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, user: session };
}

export function loginUser(email: string, password: string): AuthResult {
  if (!isStorageAvailable()) {
    return {
      ok: false,
      error:
        "Не вдалося отримати доступ до сховища на цьому пристрої. Вимкніть приватний режим браузера й спробуйте ще раз.",
    };
  }

  const users = readUsers();
  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!user || user.passwordHash !== fakeHash(password)) {
    return { ok: false, error: "Неправильний email або пароль" };
  }
  const session: SessionUser = {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
  };
  safeSetItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, user: session };
}

export function getSession(): SessionUser | null {
  const raw = safeGetItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function logout(): void {
  safeRemoveItem(SESSION_KEY);
}
