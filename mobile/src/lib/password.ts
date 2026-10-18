// Same rules as passwordChecks / isCommonPassword in web/js/views.js.
export type PasswordCheck = { ok: boolean; key: string };

export function passwordChecks(v: string): PasswordCheck[] {
  return [
    { ok: v.length >= 10, key: 'password.ruleLength' },
    { ok: /[A-Za-z؀-ۿ]/.test(v), key: 'password.ruleLetter' },
    { ok: /[0-9]/.test(v), key: 'password.ruleDigit' },
    { ok: /[^A-Za-z0-9؀-ۿ]/.test(v), key: 'password.ruleSymbol' },
  ];
}

// The rules alone still wave through "Password1!".
const COMMON_PASSWORDS = [
  'password', 'password1', 'password12', 'password123', 'password1!',
  'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty123', 'qwertyuiop',
  '1234567890', '12345678', '123456789', 'iloveyou', 'admin123',
  'welcome1', 'welcome123', 'letmein1', 'abc12345', 'football1',
  'monkey123', 'sunshine1', 'princess1', 'dragon123', 'tenthtone',
];

export function isCommonPassword(v: string) {
  const t = v.toLowerCase().replace(/\s+/g, '');
  if (COMMON_PASSWORDS.includes(t)) return true;
  // Trailing digits are the usual way people "strengthen" a weak word.
  const stem = t.replace(/[0-9!@#$%^&*._-]+$/, '');
  return stem.length >= 4 && COMMON_PASSWORDS.includes(stem);
}

export function ageOn(isoDate: string, now = new Date()): number | null {
  const b = new Date(isoDate + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

export const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
