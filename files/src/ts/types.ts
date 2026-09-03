// ==============================
// Спільні типи. Наразі опис моделі, з якою працює localStorage-мок.
// Пізніше ці ж інтерфейси будуть описувати JSON від backend API.
// ==============================

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string; // спрощене "хешування" лише для прототипу
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
}
