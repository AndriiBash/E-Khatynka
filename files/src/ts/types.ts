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

export interface ApiTag {
  id: number;
  name: string;
  iconUrl: string | null;
}

export interface ApiUserTagPreference {
  id: number;
  userId: string;
  userFullName: string;
  userEmail: string;
  tagId: number;
  tagName: string;
  tagIconUrl: string | null;
  createdAt: number;
}

export interface ApiAdminUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}
