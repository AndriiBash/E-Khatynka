import type { SessionUser, ApiCategory } from "./types.js";

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

// ==============================
// Категорії
// ==============================

export async function getCategories(): Promise<ApiCategory[]> {
  try {
    const res = await fetch("/api/categories", { credentials: "include" });
    if (!res.ok) return [];
    const data = (await res.json()) as { categories: ApiCategory[] };
    return data.categories;
  } catch {
    return [];
  }
}

export type CategoryResult =
  | { ok: true; category: ApiCategory }
  | { ok: false; error: string };

async function postOrPutCategory(
  url: string,
  method: "POST" | "PUT",
  input: { name: string; description: string; iconUrl: string }
): Promise<CategoryResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  try {
    return (await res.json()) as CategoryResult;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function createCategory(input: {
  name: string;
  description: string;
  iconUrl: string;
}): Promise<CategoryResult> {
  return postOrPutCategory("/api/admin/categories", "POST", input);
}

export async function updateCategory(
  id: number,
  input: { name: string; description: string; iconUrl: string }
): Promise<CategoryResult> {
  return postOrPutCategory(`/api/admin/categories/${id}`, "PUT", input);
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteCategory(id: number): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE", credentials: "include" });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  try {
    return (await res.json()) as DeleteResult;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

// Читаємо обраний файл у base64 і шлемо звичайним JSON-запитом — без
// multer/multipart, дивись коментар над /api/admin/upload-icon у
// server.js. Повертає той самий CategoryResult-стиль { ok, ... }.
export type UploadIconResult = { ok: true; url: string } | { ok: false; error: string };

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:<mime>;base64,<data>"
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadCategoryIcon(file: File): Promise<UploadIconResult> {
  let dataBase64: string;
  try {
    dataBase64 = await readFileAsBase64(file);
  } catch {
    return { ok: false, error: "Не вдалось прочитати файл" };
  }

  let res: Response;
  try {
    res = await fetch("/api/admin/upload-icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mimeType: file.type, dataBase64 }),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  try {
    return (await res.json()) as UploadIconResult;
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

// ==============================
// Панель адміна: кількість записів у кожній таблиці (для плиток на
// головній admin.html).
// ==============================

export async function getTableCounts(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch("/api/admin/table-counts", { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; counts?: Record<string, number> };
    return data.counts ?? null;
  } catch {
    return null;
  }
}
