// Импорт текстового экспорта GymKeeper (TXT) и склейка названий упражнений.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, июн: 6, июл: 7,
  авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

// Ключ — нормализованное (строчные, без эмодзи и лишних пробелов) название из дневника.
const ALIASES = {
  'giper back': 'Hyperextension',
  'pull to face': 'Face Pull · Cable',
  'икры': 'Standing Calf Raise · Machine',
  'caviar': 'Standing Calf Raise · Machine',
  'pull up': 'Pull Up',
  'pull-up on a horizontal bar': 'Pull Up',
  'pull up wide': 'Pull Up (Wide Grip)',
  'chin up': 'Chin Up',
  'chen up': 'Chin Up',
  'становая тяга': 'Deadlift · Barbell',
  'middle delta': 'Lateral Raise · Dumbbell',
  'meddle delta': 'Lateral Raise · Dumbbell',
  'shoulders middle delta': 'Lateral Raise · Dumbbell',
  'отведение в стороны сидя': 'Lateral Raise · Dumbbell',
  'трицепс одной рукой': 'Tricep Extension · Cable',
  'tricep by one hand': 'Tricep Extension · Cable',
  'выпады': 'Lunge · Dumbbell',
  'lunges': 'Lunge · Dumbbell',
  'кольца': 'rings',
  'pec deck · machine (with pause)': 'Pec Deck · Machine',
  'штанга бицепс': 'Curl · Barbell',
  'gym of arnold': 'Arnold Press · Dumbbell',
  'walk fermer': 'Farmer Walk',
  'back delta': 'Reverse Fly · Machine',
  'back delt': 'Reverse Fly · Machine',
  'задние дельты': 'Reverse Fly · Machine',
};

export function nameKey(name) {
  return String(name)
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeName(name) {
  const key = nameKey(name);
  if (ALIASES[key]) return ALIASES[key];
  const clean = String(name).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  return clean || String(name).trim();
}

function pad(n) { return String(n).padStart(2, '0'); }

function parseDateLine(line) {
  // "📅 15 Oct 2026 | 131 min" или "📅 15 окт. 2026"
  const m = line.match(/(\d{1,2})\s+([A-Za-zА-Яа-яё]+)\.?\s+(\d{4})(?:.*?\|\s*(\d+)\s*(?:min|мин))?/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()] || MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (!month) return null;
  return {
    date: `${m[3]}-${pad(month)}-${pad(+m[1])}`,
    duration: m[4] ? +m[4] : null,
  };
}

const SET_RE = /^\s*([\d.,]+)\s*(?:kg|кг)\s*[*x×х]\s*(\d+)(.*)$/i;

export function parseSetLine(line) {
  const m = line.match(SET_RE);
  if (!m) {
    const raw = line.trim();
    return raw ? { raw } : null;
  }
  const rest = m[3] || '';
  const set = { w: parseFloat(m[1].replace(',', '.')), r: +m[2] };
  const flag = rest.match(/,\s*(warmup|drop|normal|hard)/i);
  if (flag) set.flag = flag[1].toLowerCase();
  const note = rest.match(/\((.*)\)/);
  if (note) set.note = note[1].trim();
  return set;
}

export function parseGymKeeperTxt(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const workouts = [];
  let w = null;
  let ex = null;
  let skipped = 0;

  const closeExercise = () => {
    if (ex && ex.sets.length) w.exercises.push(ex);
    ex = null;
  };
  const closeWorkout = () => {
    closeExercise();
    if (w && w.exercises.length) workouts.push(w);
    w = null;
  };

  for (const line of lines) {
    if (/MEASUREMENTS|ЗАМЕРЫ/i.test(line)) break;
    if (line.startsWith('📅')) {
      closeWorkout();
      const d = parseDateLine(line);
      if (!d) { skipped++; continue; }
      w = { id: '', date: d.date, duration: d.duration, exercises: [], source: 'import' };
      continue;
    }
    if (!w) continue;
    if (line.startsWith('🔹')) {
      closeExercise();
      const original = line.slice(2).trim();
      ex = { name: normalizeName(original), sets: [] };
      if (ex.name !== original) ex.original = original;
      continue;
    }
    if (line.startsWith('💬')) {
      w.note = (w.note ? w.note + '\n' : '') + line.slice(2).trim();
      continue;
    }
    if (ex && /^\s/.test(line) && line.trim()) {
      const s = parseSetLine(line);
      if (s) ex.sets.push(s);
    }
  }
  closeWorkout();

  // Сначала старые, потом новые; id стабилен для одного и того же файла.
  workouts.sort((a, b) => a.date.localeCompare(b.date));
  const perDate = {};
  for (const wk of workouts) {
    perDate[wk.date] = (perDate[wk.date] || 0) + 1;
    wk.id = `imp-${wk.date}-${perDate[wk.date]}`;
  }
  return { workouts, skipped };
}
