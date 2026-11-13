// Расчёты: 1ПМ, фазы периодизации, план на день, плато, анализ.
// Чистые функции без DOM, чтобы их можно было проверять в Node.

import { L } from './i18n.js';

export const DAY_MS = 86400000;

export const PHASES = {
  volume: {
    label: L('Объём', 'Volume'), color: '#4fb3ff', load: 1,
    desc: L('Много повторов, 2 в запасе. Набиваем объём и технику.', 'High reps, 2 in reserve. Building volume and technique.'),
    compound: { reps: [12, 15], sets: 3, rir: 2, rest: 120 },
    isolation: { reps: [15, 20], sets: 3, rir: 2, rest: 60 },
  },
  hypertrophy: {
    label: L('Масса', 'Hypertrophy'), color: '#3ddc84', load: 1,
    desc: L('Средние повторы почти до отказа (1 в запасе). Главная неделя для роста.', 'Moderate reps close to failure (1 in reserve). The main week for growth.'),
    compound: { reps: [8, 12], sets: 4, rir: 1, rest: 150 },
    isolation: { reps: [10, 15], sets: 3, rir: 1, rest: 75 },
  },
  strength: {
    label: L('Сила', 'Strength'), color: '#ff9f43', load: 1,
    desc: L('Тяжело и мало повторов в базе, 2 в запасе. Изоляция остаётся 10–12.', 'Heavy, low reps on compounds, 2 in reserve. Isolation stays at 10–12.'),
    compound: { reps: [4, 6], sets: 4, rir: 2, rest: 180 },
    isolation: { reps: [10, 12], sets: 3, rir: 1, rest: 75 },
  },
  deload: {
    label: L('Разгрузка', 'Deload'), color: '#a29bfe', load: 0.85,
    desc: L('Лёгкая неделя: вес ниже, 2 подхода, далеко от отказа. Восстанавливаемся.', 'Easy week: lighter weights, 2 sets, far from failure. Recovering.'),
    compound: { reps: [8, 10], sets: 2, rir: 3, rest: 120 },
    isolation: { reps: [12, 15], sets: 2, rir: 3, rest: 60 },
  },
};

export const DEFAULT_PHASE_ORDER = ['volume', 'hypertrophy', 'strength', 'deload'];

export const WEEKDAYS = L(['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

// Сб и Вс — главные дни (зал пустой: турник, пояс с весом, штанги свободны).
// Вт и Чт — утро, в зале людно: гантели, блоки и тренажёры, которые легко найти.
// Махи в стороны есть в каждой тренировке; ноги — минимум, чтобы оставались силы на велосипед.
export const DEFAULT_TEMPLATES = {
  6: { title: 'Спина + бицепс + предплечья', exercises: [
    'Hyperextension', 'Pull Up (Wide Grip)', 'Deadlift · Barbell', 'Chin Up', 'Bent Over Row · Barbell',
    'Curl · Barbell', 'Reverse Curl · Barbell', 'Lateral Raise (техника) · Dumbbell'] },
  0: { title: 'Грудь + трицепс + плечи', exercises: [
    'Hyperextension', 'Incline Bench Press · Dumbbell', 'Chest Dip', 'Bench Press · Barbell',
    'Chest Fly · Machine', 'Tricep Extension · Cable', 'Lateral Raise · Dumbbell'] },
  2: { title: 'Плечи + руки + ягодицы', exercises: [
    'Clean and Press · Barbell', 'Seated Overhead Press · Dumbbell', 'Glute Bridge · Barbell',
    'Lateral Raise · Cable', 'Face Pull · Cable', 'Hammer Curl · Dumbbell',
    'Overhead Tricep Extension · Cable', 'Standing Calf Raise · Machine'] },
  4: { title: 'Верх на тренажёрах', exercises: [
    'Lat Pull Down · Machine', 'Hammer Strength Press · Machine', 'Seated Row · Cable',
    'Lateral Raise (техника) · Dumbbell', 'Reverse Fly · Machine', 'Wrist Curl · Barbell', 'Hanging Knee Raise'] },
};
export const PROGRAM_VERSION = 2;

export const DEFAULT_SETTINGS = {
  bodyweight: 72,
  blockStart: null, // ISO-дата понедельника, с которого начат блок
  phaseOrder: DEFAULT_PHASE_ORDER,
  phaseOverride: null, // { week: ISO понедельника, key }
};

// ---------- даты ----------

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function daysBetween(aIso, bIso) {
  return Math.round((parseISO(bIso) - parseISO(aIso)) / DAY_MS);
}
export function mondayOf(iso) {
  const d = parseISO(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// ---------- упражнения ----------

const CATALOG = {
  'Hyperextension': { kind: 'warmup', equip: 'bodyweight', muscle: 'other' },
  'Lateral Raise (техника) · Dumbbell': { kind: 'skill', equip: 'dumbbell', muscle: 'shoulders', base: 'Lateral Raise · Dumbbell',
    note: L('Лёгкий вес, медленно. Веди локтем, а не кистью, плечо вниз, мизинец не задирай. Наверху пауза 1 секунду, вниз 2–3 секунды. Чувствуешь среднюю дельту — значит, правильно.',
      'Light weight, slowly. Lead with the elbow, not the hand, shoulder down, don\'t lift the pinky. Pause 1 second at the top, 2–3 seconds down. If you feel the side delt, you\'re doing it right.') },
  'Clean and Press · Barbell': { kind: 'compound', equip: 'barbell', muscle: 'shoulders', maxReps: 8,
    note: L('Техническое упражнение: начни с пустого грифа (20 кг) и прибавляй, только если техника ровная. Спина прямая на подъёме с пола.',
      'Technical lift: start with the empty bar (20 kg) and add weight only if your form is solid. Keep your back straight when lifting from the floor.') },
  'Clean and Press · Dumbbell': { kind: 'compound', equip: 'dumbbell', muscle: 'shoulders', maxReps: 10,
    note: L('Вариант с гантелями для людного зала.', 'Dumbbell version for a crowded gym.') },
  'Deadlift · Barbell': { kind: 'compound', equip: 'barbell', muscle: 'back', maxReps: 10,
    note: L('Становая тяга: спина прямая, гриф вплотную к ногам. Работает и спина, и ноги, но без забитых квадрицепсов, как после приседа.',
      'Deadlift: straight back, bar close to your legs. Works back and legs without the quad fatigue you get from squats.') },
  'Glute Bridge · Barbell': { kind: 'compound', equip: 'barbell', muscle: 'legs',
    note: L('Можно с поясом и блинами поперёк таза. Наверху сожми ягодицы на секунду.', 'Can be done with a belt and plates across the hips. Squeeze your glutes for a second at the top.') },
  'Wrist Curl · Barbell': { kind: 'isolation', equip: 'barbell', muscle: 'forearms' },
  'Reverse Wrist Curl · Dumbbell': { kind: 'isolation', equip: 'dumbbell', muscle: 'forearms' },
  'Reverse Curl · Barbell': { kind: 'isolation', equip: 'barbell', muscle: 'forearms', note: L('Хват сверху: плечелучевая мышца и предплечья.', 'Overhand grip: brachioradialis and forearms.') },
  'Farmer Walk': { kind: 'isolation', equip: 'dumbbell', muscle: 'forearms', note: L('Тяжёлые гантели, 20–30 метров. Повторы = метры / 10.', 'Heavy dumbbells, 20–30 metres. Reps = metres / 10.') },
  'Hanging Knee Raise': { kind: 'isolation', equip: 'bodyweight', muscle: 'abs' },
  'Chest Dip': { kind: 'compound', equip: 'bodyweight', muscle: 'chest' },
  'Tricep Dip': { kind: 'compound', equip: 'bodyweight', muscle: 'triceps' },
  'Glute Bridge · Barbell': { kind: 'compound', equip: 'barbell', muscle: 'legs' },
  'Face Pull · Cable': { kind: 'isolation', equip: 'cable', muscle: 'shoulders' },
  'Hammer Strength Press · Machine': { kind: 'compound', equip: 'machine', muscle: 'chest' },
};

const COMPOUND_RE = /bench press|press|squat|deadlift|row|pull ?up|pull-up|chin up|dip|pull down|lunge|hip thrust|glute bridge|push up/i;

export function muscleOf(name) {
  const n = name.toLowerCase();
  if (CATALOG[name]) return CATALOG[name].muscle;
  if (/hyperext|giper/.test(n)) return 'other';
  if (/wrist|forearm|farmer|предплеч/.test(n)) return 'forearms';
  if (/crunch|sit up|knee raise|leg raise|plank|пресс|torso/.test(n)) return 'abs';
  if (/tricep|kickback|skull|трицепс/.test(n)) return 'triceps';
  if (/squat|lunge|leg|calf|glute|hip thrust|deadlift|икр|выпад|ног|butt/.test(n)) return 'legs';
  if (/curl|biceps|бицепс/.test(n)) return 'biceps';
  if (/overhead|lateral|delt|shoulder|arnold|face pull|reverse fly|upright|front raise|плеч/.test(n)) return 'shoulders';
  if (/pull|chin|row|lat |back|pullover|shrug|trape|тяга|спин/.test(n)) return 'back';
  if (/bench|chest|fly|pec|dip|push|груд/.test(n)) return 'chest';
  return 'other';
}

export const MUSCLE_LABELS = L({
  chest: 'Грудь', back: 'Спина', shoulders: 'Плечи', biceps: 'Бицепс',
  triceps: 'Трицепс', forearms: 'Предплечья', legs: 'Ноги', abs: 'Пресс', other: 'Другое',
}, {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps',
  triceps: 'Triceps', forearms: 'Forearms', legs: 'Legs', abs: 'Abs', other: 'Other',
});

export function exerciseMeta(name) {
  const base = CATALOG[name] || {};
  const n = name.toLowerCase();
  let equip = base.equip;
  if (!equip) {
    if (/· barbell|smith/.test(n)) equip = 'barbell';
    else if (/· dumbbell|kettl/.test(n)) equip = 'dumbbell';
    else if (/· cable/.test(n)) equip = 'cable';
    else if (/· machine/.test(n)) equip = 'machine';
    else if (/pull ?up|pull-up|chin up|dip|push up|muscle up|knee raise|leg raise|rings|кольца/.test(n)) equip = 'bodyweight';
    else equip = 'other';
  }
  const kind = base.kind || (COMPOUND_RE.test(n) && !/curl|raise|fly|extension|kickback/.test(n) ? 'compound' : 'isolation');
  const step = { barbell: 2.5, dumbbell: 2, cable: 5, machine: 5, bodyweight: 2.5, other: 2.5 }[equip];
  return { name, kind, equip, step, muscle: base.muscle || muscleOf(name), note: base.note || '', maxReps: base.maxReps || null, base: base.base || null };
}

// ---------- 1ПМ и история ----------

export function e1rm(w, r) {
  if (!w || !r || r < 1) return 0;
  return r === 1 ? w : w * (1 + r / 30); // формула Эпли
}

export function isWorkingSet(s) {
  return s && typeof s.w === 'number' && s.r > 0 && s.flag !== 'warmup';
}

// Все сессии упражнения по возрастанию даты: { date, best, sets }
export function sessionsFor(name, workouts, { maxReps = 20 } = {}) {
  const out = [];
  for (const w of workouts) {
    for (const ex of w.exercises) {
      if (ex.name !== name) continue;
      const working = ex.sets.filter(isWorkingSet);
      if (!working.length) continue;
      const usable = working.filter(s => s.r <= maxReps);
      const best = usable.reduce((m, s) => Math.max(m, e1rm(s.w, s.r)), 0);
      const prev = out[out.length - 1];
      if (prev && prev.date === w.date) {
        prev.best = Math.max(prev.best, best);
        prev.sets.push(...working);
      } else {
        out.push({ date: w.date, best, sets: [...working] });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function currentE1rm(name, workouts, today) {
  const ss = sessionsFor(name, workouts).filter(s => s.best > 0 && s.date <= today);
  if (!ss.length) return null;
  // только свежие тренировки: старые рекорды годичной давности завышают рабочий вес
  const fresh = ss.filter(s => daysBetween(s.date, today) <= 120);
  if (!fresh.length) {
    const lastOld = ss[ss.length - 1];
    return lastOld.best * (daysBetween(lastOld.date, today) > 365 ? 0.85 : 0.93);
  }
  const last = fresh.slice(-3);
  let v = Math.max(...last.map(s => s.best));
  // если последние тренировки были лёгкими, не опускаемся ниже 90% от лучшего за 3 месяца
  const best90 = Math.max(0, ...ss.filter(s => daysBetween(s.date, today) <= 90).map(s => s.best));
  v = Math.max(v, best90 * 0.9);
  const gap = daysBetween(last[last.length - 1].date, today);
  if (gap > 60) v *= 0.93; // давно не делал — начинаем осторожнее
  return v;
}

export function lastSession(name, workouts, before) {
  const ss = sessionsFor(name, workouts).filter(s => !before || s.date < before);
  return ss[ss.length - 1] || null;
}

export function formatSets(sets) {
  return sets.map(s => `${fmtW(s.w)}×${s.r}`).join(', ');
}

export function fmtW(w) {
  return Number.isInteger(w) ? String(w) : w.toFixed(w * 10 % 1 === 0 ? 1 : 2).replace(/0$/, '');
}

// ---------- периодизация ----------

export function phaseFor(iso, settings) {
  const order = settings.phaseOrder?.length ? settings.phaseOrder : DEFAULT_PHASE_ORDER;
  const week = mondayOf(iso);
  const start = settings.blockStart ? mondayOf(settings.blockStart) : week;
  const weeks = Math.floor(daysBetween(start, week) / 7);
  const len = order.length;
  const idx = ((weeks % len) + len) % len;
  let key = order[idx];
  if (settings.phaseOverride && settings.phaseOverride.week === week) key = settings.phaseOverride.key;
  return { key, phase: PHASES[key], weekInBlock: idx + 1, blockLen: len, blockNo: Math.floor(weeks / len) + 1, weekStart: week, blockStart: start };
}

export function roundWeight(w, meta, settings) {
  const step = meta.step || 2.5;
  if (meta.equip === 'bodyweight') {
    const bw = settings.bodyweight;
    if (w <= bw) return bw;
    return bw + Math.round((w - bw) / step) * step;
  }
  return Math.max(step, Math.round(w / step) * step);
}

// Вес под нужные повторы с запасом: 1ПМ / (1 + (повторы + запас) / 30)
export function weightFor(e, reps, rir, load = 1) {
  return (e * load) / (1 + (reps + rir) / 30);
}

export function prescribe(name, phaseKey, workouts, settings, today) {
  const meta = exerciseMeta(name);
  const ph = PHASES[phaseKey];
  const last = lastSession(name, workouts, today);
  if (meta.kind === 'warmup') {
    const lw = last?.sets?.[0]?.w ?? settings.bodyweight;
    return { name, meta, sets: 2, reps: [15, 25], targetReps: 20, rir: 3, rest: 60, weight: lw, e1rm: null, last, warmup: true };
  }
  if (meta.kind === 'skill') {
    // 40% от рабочего 1ПМ махов: вес, на котором можно думать о мышце, а не о весе
    const be = currentE1rm(meta.base || name, workouts, today) || currentE1rm(name, workouts, today);
    const weight = be ? Math.max(meta.step, roundWeight(be * 0.4, meta, settings)) : null;
    return { name, meta, sets: 3, reps: [15, 20], targetReps: 15, rir: 4, rest: 45, weight, e1rm: null, last, skill: true, load: 1 };
  }
  let z = meta.kind === 'compound' ? ph.compound : ph.isolation;
  if (meta.maxReps && z.reps[1] > meta.maxReps) {
    // становая и взятие с пола — не на 15 повторов: техника разваливается раньше мышц
    const hi = meta.maxReps;
    z = { ...z, reps: [Math.max(3, Math.min(z.reps[0], hi - 2)), hi] };
  }
  const targetReps = Math.round((z.reps[0] + z.reps[1]) / 2);
  const e = currentE1rm(name, workouts, today);
  let weight = null;
  let reps = targetReps;
  let bodyweightOnly = false;
  if (meta.equip === 'bodyweight' && meta.kind === 'isolation') {
    // пресс и подобное: работаем повторами, без отягощения
    return { name, meta, sets: z.sets, reps: z.reps, targetReps, rir: z.rir, rest: z.rest,
      weight: settings.bodyweight, e1rm: e, last, bodyweightOnly: true, load: ph.load };
  }
  if (e) {
    const raw = weightFor(e, targetReps, z.rir, ph.load);
    if (meta.equip === 'bodyweight' && raw < settings.bodyweight) {
      weight = settings.bodyweight;
      bodyweightOnly = true;
      const maxReps = Math.floor(30 * ((e * ph.load) / settings.bodyweight - 1));
      reps = Math.max(3, Math.min(z.reps[1], maxReps - z.rir));
    } else {
      weight = roundWeight(raw, meta, settings);
    }
  }
  return {
    name, meta, sets: z.sets, reps: z.reps, targetReps: reps, rir: z.rir, rest: z.rest,
    weight, e1rm: e, last, bodyweightOnly, load: ph.load,
  };
}

// Подстройка оставшихся подходов по факту выполненного: вес, повторы и сколько осталось в запасе.
export function adjustedWeight(plan, done, settings) {
  const e = e1rm(done.w, done.r + (done.rir ?? plan.rir));
  const raw = weightFor(e, plan.targetReps, plan.rir, 1);
  if (plan.meta.equip === 'bodyweight' && raw < settings.bodyweight) return settings.bodyweight;
  return roundWeight(raw, plan.meta, settings);
}

// ---------- тренды и плато ----------

export function trend(name, workouts, today, windowDays = 35) {
  const ss = sessionsFor(name, workouts, { maxReps: 12 }).filter(s => s.best > 0);
  const recent = ss.filter(s => { const d = daysBetween(s.date, today); return d >= 0 && d < windowDays; });
  const prev = ss.filter(s => { const d = daysBetween(s.date, today); return d >= windowDays && d < windowDays * 2; });
  if (!recent.length || !prev.length) return null;
  const r = Math.max(...recent.map(s => s.best));
  const p = Math.max(...prev.map(s => s.best));
  const change = r / p - 1;
  const status = change > 0.015 ? 'up' : change < -0.025 ? 'down' : 'plateau';
  return { status, change, recent: r, prev: p };
}

// ---------- анализ ----------

export function weeklySetsByMuscle(workouts, today, weeks = 4) {
  const from = addDays(today, -7 * weeks);
  const totals = {};
  for (const w of workouts) {
    if (w.date <= from || w.date > today) continue;
    for (const ex of w.exercises) {
      const m = muscleOf(ex.name);
      if (m === 'other') continue;
      const n = ex.sets.filter(isWorkingSet).length;
      totals[m] = (totals[m] || 0) + n;
    }
  }
  const out = {};
  for (const k of Object.keys(MUSCLE_LABELS)) if (k !== 'other') out[k] = (totals[k] || 0) / weeks;
  return out;
}

function zoneOfReps(r) {
  if (r <= 6) return 'strength';
  if (r <= 11) return 'hypertrophy';
  return 'volume';
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// Какой диапазон повторов исторически давал прирост силы именно тебе.
// Окна по 4 недели со сдвигом 2 недели: зона окна = медиана повторов рабочих подходов,
// прирост = лучший 1ПМ (по подходам 3–12 повторов) в следующие 4 недели против этого окна.
export function repZoneResponse(workouts, names, today) {
  const agg = { strength: [], hypertrophy: [], volume: [] };
  if (!workouts.length) return { zones: agg, n: 0 };
  const first = workouts[0].date;
  for (const name of names) {
    const ss = sessionsFor(name, workouts, { maxReps: 30 });
    if (ss.length < 8) continue;
    for (let start = first; daysBetween(start, today) >= 56; start = addDays(start, 14)) {
      const mid = addDays(start, 28);
      const end = addDays(start, 56);
      const a = ss.filter(s => s.date >= start && s.date < mid);
      const b = ss.filter(s => s.date >= mid && s.date < end);
      if (a.length < 2 || !b.length) continue;
      const reps = a.flatMap(s => s.sets.map(x => x.r));
      const bestOf = arr => Math.max(0, ...arr.flatMap(s => s.sets.filter(x => x.r >= 3 && x.r <= 12).map(x => e1rm(x.w, x.r))));
      const ea = bestOf(a);
      const eb = bestOf(b);
      if (!ea || !eb) continue;
      agg[zoneOfReps(median(reps))].push(eb / ea - 1);
    }
  }
  const zones = {};
  let n = 0;
  for (const [k, v] of Object.entries(agg)) {
    zones[k] = { n: v.length, mean: v.length ? v.reduce((x, y) => x + y, 0) / v.length : null };
    n += v.length;
  }
  return { zones, n };
}

export function frequencyStats(workouts, today, weeks = 12) {
  const from = addDays(today, -7 * weeks);
  const recent = workouts.filter(w => w.date > from && w.date <= today);
  const durs = recent.map(w => w.duration).filter(Boolean);
  return {
    perWeek: recent.length / weeks,
    avgDuration: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
    count: recent.length,
  };
}

// ---------- советы на сегодня ----------

export function adviceForToday({ plans, phaseInfo, workouts, today, settings }) {
  const tips = [];
  const { phase, key, weekInBlock, blockLen } = phaseInfo;
  if (phaseInfo.blockNo < 1) {
    const d = parseISO(phaseInfo.blockStart);
    const month = L(['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])[d.getMonth()];
    tips.push(L(`Блок 1 начнётся в понедельник, ${d.getDate()} ${month}. Эту неделю работаешь как привык: «${phase.label}», ${phase.compound.reps[0]}–${phase.compound.reps[1]} повторов в базе.`,
      `Block 1 starts on Monday, ${month} ${d.getDate()}. This week train as usual: "${phase.label}", ${phase.compound.reps[0]}–${phase.compound.reps[1]} reps on compounds.`));
  } else {
    tips.push(L(`Неделя ${weekInBlock} из ${blockLen}: «${phase.label}». ${phase.desc}`, `Week ${weekInBlock} of ${blockLen}: "${phase.label}". ${phase.desc}`));
  }
  if (key === 'deload') tips.push(L('Не добивай подходы до отказа на этой неделе: вся польза разгрузки в том, чтобы отдохнуть.', 'Don\'t take sets to failure this week: the whole point of a deload is to recover.'));
  if (key === 'strength') tips.push(L('Хорошо разомнись: 2–3 подхода с растущим весом перед первым рабочим.', 'Warm up well: 2–3 sets with increasing weight before the first working set.'));

  const lastW = [...workouts].reverse().find(w => w.date < today);
  if (lastW) {
    const gap = daysBetween(lastW.date, today);
    if (gap >= 6) tips.push(L(`Последняя тренировка была ${gap} дн. назад. Первые подходы делай чуть легче плана.`, `Your last workout was ${gap} days ago. Make the first sets a bit lighter than planned.`));
  }

  const plateaus = plans.filter(p => p.trend?.status === 'plateau').map(p => p.name);
  const downs = plans.filter(p => p.trend?.status === 'down').map(p => p.name);
  if (plateaus.length) tips.push(L(`Плато больше месяца: ${plateaus.join(', ')}. Если так же будет и после этого блока, поменяй вариант упражнения (угол, хват, гантели вместо штанги).`,
    `Plateau for over a month: ${plateaus.join(', ')}. If it stays the same after this block, change the variation (angle, grip, dumbbells instead of barbell).`));
  if (downs.length) tips.push(L(`Падение силы: ${downs.join(', ')}. Проверь сон и еду: при наборе массы вес тела должен расти примерно на 0,25–0,5 кг в неделю.`,
    `Strength is dropping: ${downs.join(', ')}. Check sleep and food: when bulking, bodyweight should go up about 0.25–0.5 kg per week.`));

  const recentCount = workouts.filter(w => w.date < today && daysBetween(w.date, today) <= 28).length;
  if (recentCount < 4) return tips;
  const vol = weeklySetsByMuscle(workouts, today, 4);
  const low = Object.entries(vol).filter(([m, v]) => v < 8 && m !== 'abs' && m !== 'forearms').map(([m]) => MUSCLE_LABELS[m].toLowerCase());
  if (low.length) tips.push(L(`Мало подходов за последние 4 недели (меньше 8 в неделю): ${low.join(', ')}. Для массы нужно 10–20 рабочих подходов на мышцу в неделю.`,
    `Too few sets over the last 4 weeks (under 8 per week): ${low.join(', ')}. For muscle growth you need 10–20 working sets per muscle per week.`));
  return tips;
}
