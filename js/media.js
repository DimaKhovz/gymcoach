// Картинки упражнений из free-exercise-db (общественное достояние).
// Встроенные кадры лежат в img/ex, остальные подгружаются из репозитория базы по выбору в поиске.

const REMOTE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const PICKS_KEY = 'gc.media';

let mapping = {};
let bundled = {};
let ru = {};
let index = null;
let picks = {};

try { picks = JSON.parse(localStorage.getItem(PICKS_KEY) || '{}'); } catch { picks = {}; }

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

export async function initMedia() {
  const [m, b, t] = await Promise.allSettled([
    getJson('data/mapping.json'),
    getJson('data/instructions-en.json'),
    getJson('data/instructions-ru.json'),
  ]);
  if (m.status === 'fulfilled') mapping = m.value;
  if (b.status === 'fulfilled') bundled = b.value;
  if (t.status === 'fulfilled') ru = t.value;
}

export function dbIdFor(name) {
  return picks[name] || mapping[name] || null;
}

// { frames: [url0, url1], title, local } или null
export function mediaFor(name) {
  const id = dbIdFor(name);
  if (!id) return null;
  const b = bundled[id];
  if (b) {
    return { id, local: true, title: ru[id]?.name || b.name, frames: [`img/ex/${b.file}-0.webp`, `img/ex/${b.file}-1.webp`] };
  }
  return { id, local: false, title: id.replace(/_/g, ' '), frames: [`${REMOTE}${id}/0.jpg`, `${REMOTE}${id}/1.jpg`] };
}

export async function stepsFor(id) {
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

export async function searchDb(query) {
  if (!index) index = await getJson('data/exdb-index.json');
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  // чем больше слов совпало, тем выше; встроенные упражнения при равенстве — первыми
  const res = words.length
    ? index
      .map(row => {
        const s = (row[0] + ' ' + row[1]).toLowerCase();
        return { row, score: words.filter(w => s.includes(w)).length + (bundledThumb(row[0]) ? 0.5 : 0) };
      })
      .filter(x => x.score >= 1)
      .sort((a, b) => b.score - a.score)
      .map(x => x.row)
    : index;
  return res.slice(0, 40).map(([id, name, muscle, equip]) => ({
    id, name, muscle, equip,
    thumb: bundledThumb(id) || `${REMOTE}${id}/0.jpg`,
  }));
}

function bundledThumb(id) {
  return bundled[id] ? `img/ex/${bundled[id].file}-0.webp` : null;
}
