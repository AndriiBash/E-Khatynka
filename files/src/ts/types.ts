// ==============================
// Спільні типи для JSON, який приходить від backend API (server.js).
// ==============================

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface ApiCategory {
  id: number;
  name: string;
  description: string | null;
  iconUrl: string | null;
}
