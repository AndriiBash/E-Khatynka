import type { SessionUser } from "./types.js";

// ==============================
// Клієнт до реального backend API (server.js + SQLite, /api/*).
// Сигнатури тих самих функцій, що були в localStorage-моку, лишились
// незмінними (тепер тільки асинхронні) — саме для цього вони й були
// спроектовані так із самого початку, дивись старий коментар нижче.
// ==============================

export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

const NETWORK_ERROR =
  "Немає з'єднання із сервером (backend error).";

async function postJson(url: string, body: unknown): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  try {
    return (await res.json()) as AuthResult;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  return postJson("/api/register", input);
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  return postJson("/api/login", { email, password });
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: SessionUser | null };
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
  } catch {
    // Немає з'єднання — на клієнті все одно нічого зберігати, сесія
    // живе тільки в куці, яку видає сервер.
  }
}
