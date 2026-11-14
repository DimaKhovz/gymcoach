// Картинки упражнений из free-exercise-db (общественное достояние).
// Встроенные кадры лежат в img/ex, остальные подгружаются из репозитория базы по выбору в поиске.
// Свои упражнения хранят фото, снятое на телефон (gc.custom).

import { LANG } from './i18n.js';

const REMOTE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const PICKS_KEY = 'gc.media';
export const CUSTOM_KEY = 'gc.custom';

let mapping = {};
let bundled = {};
let ru = {};
let ruNames = {};
let index = null;
let picks = {};
let custom = {};

try { picks = JSON.parse(localStorage.getItem(PICKS_KEY) || '{}'); } catch { picks = {}; }
try { custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); } catch { custom = {}; }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

export async function initMedia() {
  const [m, b, t, n] = await Promise.allSettled([
    getJson('data/mapping.json'),
    getJson('data/instructions-en.json'),
    getJson('data/instructions-ru.json'),
    getJson('data/names-ru.json'),
  ]);
  if (m.status === 'fulfilled') mapping = m.value;
  if (b.status === 'fulfilled') bundled = b.value;
  if (t.status === 'fulfilled') ru = t.value;
  if (n.status === 'fulfilled') ruNames = n.value;
}

export function dbIdFor(name) {
  return picks[name] || mapping[name] || null;
}

// Все упражнения, встроенные в приложение (названия как в дневнике)
export function bundledNames() {
  return Object.keys(mapping).filter(n => bundled[mapping[n]]);
}

// Название в дневнике для упражнения базы, если оно встроено
export function appNameFor(id) {
  return Object.keys(mapping).find(n => mapping[n] === id && !n.includes('(техника)')) || null;
}

export function ruNameFor(id) {
  return ru[id]?.name || ruNames[id] || null;
}

// { frames: [url0, url1], title, local } или null
export function mediaFor(name) {
  const c = custom[name];
  if (c?.photo) return { id: null, custom: true, local: true, title: name.split(' · ')[0], en: name, frames: [c.photo, c.photo] };
  const id = dbIdFor(name);
  if (!id) return null;
  const b = bundled[id];
  if (b) {
    return { id, local: true, title: LANG === 'en' ? b.name : (ru[id]?.name || b.name), en: b.name, frames: [`img/ex/${b.file}-0.webp`, `img/ex/${b.file}-1.webp`] };
  }
  const title = LANG === 'en' ? id.replace(/_/g, ' ') : (ruNames[id] || id.replace(/_/g, ' '));
  return { id, local: false, title, en: id.replace(/_/g, ' '), frames: [`${REMOTE}${id}/0.jpg`, `${REMOTE}${id}/1.jpg`] };
}

export async function stepsFor(id) {
  if (!id) return { steps: [], lang: LANG };
  if (LANG === 'en' && bundled[id]) return { steps: bundled[id].steps, lang: 'en' };
  if (ru[id]) return { steps: ru[id].steps, lang: 'ru' };
  if (bundled[id]) return { steps: bundled[id].steps, lang: 'en' };
  try {
    const ex = await getJson(`${REMOTE}${id}.json`);
    return { steps: ex.instructions || [], lang: 'en' };
  } catch {
    return { steps: [], lang: 'en' };
  }
}

export function setPick(name, id) {
  if (id) picks[name] = id;
  else delete picks[name];
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* не критично */ }
}

// ---------- свои упражнения с фото ----------

export function customInfo(name) { return custom[name] || null; }
export function customNames() { return Object.keys(custom); }
export function saveCustom(name, info) {
  custom[name] = info;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom)); // ошибку переполнения покажет вызывающий
}

// Фото с камеры ужимаем до 360 px по ширине, чтобы влезало в память телефона (≈30 КБ).
export function shrinkPhoto(file, width = 360) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, width / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('photo')); };
    img.src = url;
  });
}

// ---------- поиск по базе (873 упражнения) ----------

const RU_MUSCLE = {
  biceps: 'бицепс руки', triceps: 'трицепс руки', chest: 'грудь грудные', shoulders: 'плечи дельты дельта',
  lats: 'спина широчайшие', 'middle back': 'спина', 'lower back': 'поясница спина', traps: 'трапеции спина',
  forearms: 'предплечья хват', quadriceps: 'ноги квадрицепс бедро', hamstrings: 'ноги бицепс бедра',
  glutes: 'ягодицы', calves: 'икры ноги', abdominals: 'пресс живот', adductors: 'ноги', abductors: 'ноги', neck: 'шея',
};
const RU_EQUIP = {
  dumbbell: 'гантели гантель', barbell: 'штанга гриф', cable: 'блок трос кроссовер', machine: 'тренажёр тренажер',
  kettlebells: 'гиря гири', 'body only': 'свой вес без веса', 'e-z curl bar': 'ez-гриф изогнутый гриф штанга',
  bands: 'резина эспандер', 'medicine ball': 'медбол мяч', 'exercise ball': 'фитбол мяч', 'foam roll': 'ролик мфр',
};

// Русские слова сравниваем по основе: «гантели», «гантелей», «гантелями» — одно и то же.
export const stem = w => (/[а-яё]/.test(w) && w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w);
export const norm = s => s.toLowerCase().replace(/ё/g, 'е');

let searchText = null;
export async function searchDb(query) {
  if (!index) index = await getJson('data/exdb-index.json');
  if (!searchText) {
    searchText = index.map(([id, name, muscle, equip]) =>
      norm(`${id.replace(/_/g, ' ')} ${name} ${ruNameFor(id) || ''} ${RU_MUSCLE[muscle] || ''} ${RU_EQUIP[equip] || ''} ${muscle} ${equip}`));
  }
  const words = norm(query).split(/\s+/).filter(w => w.length > 1).map(stem);
  // чем больше слов совпало, тем выше; встроенные упражнения при равенстве — первыми
  const res = words.length
    ? index
      .map((row, i) => ({ row, score: words.filter(w => searchText[i].includes(w)).length + (bundled[row[0]] ? 0.5 : 0) }))
      .filter(x => x.score >= Math.max(1, words.length - 1))
      .sort((a, b) => b.score - a.score)
      .map(x => x.row)
    : index;
  return res.slice(0, 40).map(([id, name, muscle, equip]) => ({
    id, name, muscle, equip,
    ru: ruNameFor(id),
    bundled: !!bundled[id],
    thumb: bundledThumb(id) || `${REMOTE}${id}/0.jpg`,
  }));
}

function bundledThumb(id) {
  return bundled[id] ? `img/ex/${bundled[id].file}-0.webp` : null;
}
