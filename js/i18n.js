// Язык интерфейса: русский или английский. Выбор хранится в телефоне, смена перезагружает страницу.

const KEY = 'gc.lang';
let lang = 'ru';
try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'ru'; } catch { /* Node и приватный режим: русский */ }

export const LANG = lang;

// L('по-русски', 'in English') — строка на текущем языке
export const L = (ru, en) => (lang === 'en' ? en : ru);

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch { /* не критично */ }
  location.reload();
}

// Названия дней программы хранятся как ввёл пользователь; стандартные переводим при показе.
const DAY_TITLES = {
  'Спина + бицепс + предплечья': 'Back + biceps + forearms',
  'Грудь + трицепс + плечи': 'Chest + triceps + shoulders',
  'Плечи + руки + ягодицы': 'Shoulders + arms + glutes',
  'Верх на тренажёрах': 'Upper body on machines',
  'Новая тренировка': 'New workout',
  'Тренировка': 'Workout',
};
export const dayTitle = t => (lang === 'en' ? (DAY_TITLES[t] || t) : t);

// Внутреннее имя «техничных» махов содержит русское слово — переводим только при показе.
export const exName = n => (lang === 'en' ? String(n).replace('(техника)', '(technique)') : n);
