import { parseGymKeeperTxt, normalizeName } from './parser.js';
import * as E from './engine.js';

// ---------- хранилище ----------

const KEYS = { workouts: 'gc.workouts', settings: 'gc.settings', templates: 'gc.templates', draft: 'gc.draft' };

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    toast('Не удалось сохранить: ' + e.message);
  }
}

const state = {
  workouts: load(KEYS.workouts, []),
  settings: { ...E.DEFAULT_SETTINGS, ...load(KEYS.settings, {}) },
  templates: load(KEYS.templates, E.DEFAULT_TEMPLATES),
  draft: load(KEYS.draft, null),
  tab: 'today',
  pickDay: null,
  progressEx: null,
  progressRange: 365,
  historyLimit: 30,
};

const today = () => E.toISO(new Date());

if (!state.settings.blockStart) {
  state.settings.blockStart = E.mondayOf(today());
  save(KEYS.settings, state.settings);
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

function persistWorkouts() {
  state.workouts.sort((a, b) => a.date.localeCompare(b.date));
  save(KEYS.workouts, state.workouts);
}

// ---------- утилиты ----------

const view = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtW = w => (w == null ? '—' : E.fmtW(w));
const pct = x => (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function fmtDate(iso, withYear = true) {
  const d = E.parseISO(iso);
  return `${E.WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_RU[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}
function fmtSec(s) {
  const a = Math.abs(Math.round(s));
  return `${s < 0 ? '+' : ''}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

function knownNames() {
  const count = {};
  for (const w of state.workouts) for (const ex of w.exercises) count[ex.name] = (count[ex.name] || 0) + 1;
  for (const t of Object.values(state.templates)) for (const n of t.exercises) count[n] = count[n] || 0;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

function trendBadge(t, e) {
  if (!e) return '<span class="badge new">нет истории</span>';
  if (!t) return '';
  const label = { up: 'растёт', plateau: 'плато', down: 'падает' }[t.status];
  return `<span class="badge ${t.status}" title="Лучший 1ПМ за 5 недель против 5 недель до этого">${label} ${pct(t.change)}</span>`;
}

// ---------- фаза в шапке ----------

function renderPhasePill() {
  const p = E.phaseFor(today(), state.settings);
  document.getElementById('phasePill').innerHTML =
    `<span class="dot" style="background:${p.phase.color}"></span>Блок ${p.blockNo} · ${p.weekInBlock}/${p.blockLen} · ${p.phase.label}`;
}

// ---------- СЕГОДНЯ ----------

function nextTrainingDay() {
  const days = Object.keys(state.templates).map(Number);
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = (now.getDay() + i) % 7;
    if (days.includes(d)) return { day: d, inDays: i };
  }
  return { day: days[0], inDays: 0 };
}

function planFor(dayKey) {
  const t = today();
  const ph = E.phaseFor(t, state.settings);
  const tpl = state.templates[dayKey];
  const plans = (tpl?.exercises || []).map(n => ({
    ...E.prescribe(n, ph.key, state.workouts, state.settings, t),
    trend: E.trend(n, state.workouts, t),
  }));
  return { ph, tpl, plans };
}

function targetText(p) {
  if (p.warmup) return `Разминка: <b>${p.sets} × ${p.reps[0]}–${p.reps[1]}</b>, без отказа`;
  const reps = `${p.reps[0]}–${p.reps[1]}`;
  let w;
  if (p.weight == null) w = 'вес подбери сам';
  else if (p.meta.equip === 'bodyweight') {
    const add = p.weight - state.settings.bodyweight;
    w = add > 0 ? `+${fmtW(add)} кг` : 'свой вес';
  } else w = `${fmtW(p.weight)} кг`;
  const reptarget = p.bodyweightOnly && p.meta.kind === 'compound' ? `по ${p.targetReps}` : `${reps} (цель ${p.targetReps})`;
  return `<b>${p.sets} × ${reptarget}</b> · <b>${w}</b> · ${p.rir} в запасе · отдых ${fmtSec(p.rest)}`;
}

function renderToday() {
  if (state.draft) return renderSession();
  requestAnimationFrame(() => view.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const hasData = state.workouts.length > 0;
  const nt = nextTrainingDay();
  const dayKey = state.pickDay ?? nt.day;
  const { ph, tpl, plans } = planFor(dayKey);
  const tips = E.adviceForToday({ plans, phaseInfo: ph, workouts: state.workouts, today: today(), settings: state.settings });

  const chips = Object.entries(state.templates)
    .sort(([a], [b]) => ((+a + 6) % 7) - ((+b + 6) % 7))
    .map(([k, t]) => `<button class="chip ${+k === +dayKey ? 'on' : ''}" data-day="${k}">${E.WEEKDAYS[k]} · ${esc(t.title)}</button>`)
    .join('');

  const when = state.pickDay == null
    ? (nt.inDays === 0 ? 'Сегодня по плану' : nt.inDays === 1 ? 'Завтра по плану' : `Ближайшая тренировка через ${nt.inDays} дн.`)
    : 'Выбрана тренировка';

  view.innerHTML = `
    ${hasData ? '' : `
      <div class="card">
        <h3>Загрузи свою историю</h3>
        <p class="muted small">В GymKeeper: Настройки → Экспорт → TXT. Потом выбери этот файл здесь. По истории приложение посчитает рабочие веса.</p>
        <button class="primary block" data-act="import-txt">Импортировать TXT из GymKeeper</button>
      </div>`}
    <div class="chips">${chips}</div>
    <div class="card">
      <div class="small muted">${when}</div>
      <h2 style="margin:2px 0 10px">${esc(tpl?.title || 'Тренировка')}</h2>
      <ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    ${plans.map(p => `
      <div class="card tight">
        <div class="ex-head">
          <div class="ex-name">${esc(p.name)}</div>
          ${p.warmup ? '' : trendBadge(p.trend, p.e1rm)}
        </div>
        <div class="target">${targetText(p)}</div>
        <div class="small muted">${p.last ? `Прошлый раз (${fmtDate(p.last.date, false)}): ${esc(E.formatSets(p.last.sets))}` : 'Ещё не делал'}
        ${p.e1rm ? ` · 1ПМ ≈ ${Math.round(p.e1rm)} кг` : ''}</div>
      </div>`).join('')}
    <button class="primary block" data-act="start" data-day="${dayKey}">Начать тренировку</button>
    <p class="small muted" style="margin-top:12px">Вес считается от твоего 1ПМ (лучшее из последних 3 тренировок, формула Эпли) под нужные повторы с запасом. Во время тренировки следующие подходы подстраиваются под то, как прошёл предыдущий.</p>
  `;
}

function startSession(dayKey) {
  const { ph, tpl, plans } = planFor(dayKey);
  state.draft = {
    date: today(),
    startedAt: Date.now(),
    dayKey,
    title: tpl?.title || 'Тренировка',
    phaseKey: ph.key,
    items: plans.map(p => makeItem(p)),
  };
  save(KEYS.draft, state.draft);
  requestWakeLock();
  render();
  window.scrollTo(0, 0);
}

function makeItem(p) {
  const { trend, last, ...plan } = p;
  return {
    name: p.name,
    plan,
    lastText: last ? `${fmtDate(last.date, false)}: ${E.formatSets(last.sets)}` : '',
    trend,
    sets: Array.from({ length: p.sets }, () => ({
      w: p.weight, r: p.targetReps, rir: p.rir, done: false, edited: false,
    })),
  };
}

function renderSession() {
  const d = state.draft;
  const ph = E.PHASES[d.phaseKey];
  const mins = Math.round((Date.now() - d.startedAt) / 60000);
  const doneSets = d.items.reduce((n, it) => n + it.sets.filter(s => s.done).length, 0);
  const options = knownNames().map(n => `<option value="${esc(n)}">`).join('');

  view.innerHTML = `
    <div class="card tight">
      <div class="row between">
        <div>
          <div class="small muted">${fmtDate(d.date)} · ${mins} мин · ${doneSets} подх.</div>
          <h3 style="margin:2px 0 0">${esc(d.title)}</h3>
        </div>
        <span class="pill"><span class="dot" style="background:${ph.color}"></span>${ph.label}</span>
      </div>
    </div>
    ${d.items.map((it, i) => renderItem(it, i)).join('')}
    <div class="card tight">
      <div class="row">
        <input class="grow" list="exNames" id="addExName" placeholder="Добавить упражнение">
        <button data-act="add-ex">Добавить</button>
      </div>
      <datalist id="exNames">${options}</datalist>
    </div>
    <div class="row" style="gap:10px">
      <button class="danger grow" data-act="cancel">Отменить</button>
      <button class="primary grow" data-act="finish">Завершить и сохранить</button>
    </div>
  `;
}

function renderItem(it, i) {
  const p = it.plan;
  const isBw = p.meta.equip === 'bodyweight';
  const rows = it.sets.map((s, j) => `
    <tr class="${s.done ? 'done' : ''}">
      <td class="n">${j + 1}</td>
      <td><input type="number" inputmode="decimal" step="any" value="${s.w ?? ''}" data-i="${i}" data-j="${j}" data-f="w" placeholder="кг"></td>
      <td><input type="number" inputmode="numeric" value="${s.r ?? ''}" data-i="${i}" data-j="${j}" data-f="r"></td>
      <td><select data-i="${i}" data-j="${j}" data-f="rir">${[0, 1, 2, 3, 4].map(v => `<option value="${v}" ${+s.rir === v ? 'selected' : ''}>${v === 4 ? '4+' : v}</option>`).join('')}</select></td>
      <td class="ok"><button class="check" data-act="toggle-set" data-i="${i}" data-j="${j}" aria-label="Подход выполнен">✓</button></td>
    </tr>`).join('');
  return `
    <div class="card tight">
      <div class="ex-head">
        <div class="ex-name">${esc(it.name)}</div>
        <button class="ghost small" data-act="remove-ex" data-i="${i}" aria-label="Убрать упражнение">✕</button>
      </div>
      <div class="target">${targetText(p)}</div>
      ${it.lastText ? `<div class="small muted">Прошлый раз ${esc(it.lastText)}</div>` : ''}
      <table class="sets">
        <thead><tr><th></th><th>${isBw ? 'Вес с телом' : 'Вес'}</th><th>Повт.</th><th>В запасе</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row" style="margin-top:6px">
        <button class="small" data-act="add-set" data-i="${i}">+ подход</button>
        ${it.sets.length > 1 ? `<button class="small ghost" data-act="del-set" data-i="${i}">− подход</button>` : ''}
      </div>
    </div>`;
}

function toggleSet(i, j) {
  const it = state.draft.items[i];
  const s = it.sets[j];
  s.done = !s.done;
  if (s.done && s.w && s.r && !it.plan.warmup) {
    // подстраиваем следующие невыполненные подходы, которые ты не правил руками
    const next = E.adjustedWeight(it.plan, { w: +s.w, r: +s.r, rir: +s.rir }, state.settings);
    for (const n of it.sets.slice(j + 1)) {
      if (!n.done && !n.edited) n.w = next;
    }
  }
  if (s.done) startTimer(it.plan.rest || 90);
  save(KEYS.draft, state.draft);
  renderSession();
}

function finishSession() {
  const d = state.draft;
  const exercises = d.items
    .map(it => ({
      name: it.name,
      sets: it.sets.filter(s => s.done && s.w !== '' && s.r).map(s => ({
        w: +s.w, r: +s.r, rir: +s.rir, ...(it.plan.warmup ? { flag: 'warmup' } : {}),
      })),
    }))
    .filter(ex => ex.sets.length);
  if (!exercises.length) {
    if (!confirm('Нет отмеченных подходов. Выйти без сохранения?')) return;
  } else {
    state.workouts.push({
      id: 'app-' + d.startedAt,
      date: d.date,
      duration: Math.max(1, Math.round((Date.now() - d.startedAt) / 60000)),
      exercises,
      source: 'app',
      phase: d.phaseKey,
    });
    persistWorkouts();
    toast(`Сохранено: ${exercises.length} упр., ${exercises.reduce((n, e) => n + e.sets.length, 0)} подходов`);
  }
  state.draft = null;
  save(KEYS.draft, null);
  stopTimer();
  releaseWakeLock();
  state.pickDay = null;
  render();
}

// ---------- таймер отдыха ----------

let timer = null;
function startTimer(sec) {
  timer = { end: Date.now() + sec * 1000, total: sec, buzzed: false };
  document.body.classList.add('timer-on');
  tickTimer();
}
function stopTimer() {
  timer = null;
  document.body.classList.remove('timer-on');
}
function tickTimer() {
  if (!timer) return;
  const left = (timer.end - Date.now()) / 1000;
  document.getElementById('timerTime').textContent = fmtSec(left);
  document.getElementById('timerBar').style.width = Math.min(100, Math.max(0, 100 * (1 - left / timer.total))) + '%';
  document.getElementById('timer').classList.toggle('over', left <= 0);
  if (left <= 0 && !timer.buzzed) {
    timer.buzzed = true;
    navigator.vibrate?.([300, 120, 300]);
    beep();
  }
  if (left < -300) stopTimer();
}
setInterval(tickTimer, 500);

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.35);
  } catch { /* звук необязателен */ }
}

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.draft) requestWakeLock();
});

// ---------- ИСТОРИЯ ----------

function renderHistory() {
  const list = [...state.workouts].reverse();
  if (!list.length) {
    view.innerHTML = `<div class="empty muted">Пока пусто. Импортируй дневник в настройках или проведи первую тренировку.</div>`;
    return;
  }
  const shown = list.slice(0, state.historyLimit);
  view.innerHTML = `
    <h2>История <span class="muted small">${list.length} тренировок</span></h2>
    ${shown.map(w => {
      const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
      const ph = w.phase ? E.PHASES[w.phase] : null;
      return `
      <details class="wk">
        <summary>
          <div class="row between">
            <b>${fmtDate(w.date)}</b>
            ${ph ? `<span class="pill"><span class="dot" style="background:${ph.color}"></span>${ph.label}</span>` : ''}
          </div>
          <div class="small muted">${w.exercises.length} упр. · ${sets} подх.${w.duration ? ` · ${w.duration} мин` : ''} · ${esc(w.exercises.slice(0, 3).map(e => e.name.split(' · ')[0]).join(', '))}${w.exercises.length > 3 ? '…' : ''}</div>
        </summary>
        <div class="body">
          ${w.exercises.map(e => `
            <div class="ex-line"><div>${esc(e.name)}</div>
            <div class="sets-txt">${e.sets.map(s => s.raw ? esc(s.raw) : `${fmtW(s.w)}×${s.r}${s.flag ? ` <i>${esc(s.flag)}</i>` : ''}${s.rir != null ? ` <span title="в запасе">(${s.rir})</span>` : ''}`).join(' · ')}</div></div>`).join('')}
          ${w.note ? `<div class="small muted">${esc(w.note)}</div>` : ''}
          <div class="row" style="margin-top:8px"><button class="small danger" data-act="del-workout" data-id="${esc(w.id)}">Удалить тренировку</button></div>
        </div>
      </details>`;
    }).join('')}
    ${list.length > shown.length ? `<button class="block" data-act="more-history">Показать ещё</button>` : ''}
  `;
}

// ---------- ПРОГРЕСС ----------

function renderProgress() {
  const counts = {};
  for (const w of state.workouts) for (const e of w.exercises) {
    if (e.sets.some(E.isWorkingSet)) counts[e.name] = (counts[e.name] || 0) + 1;
  }
  const names = Object.entries(counts).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (!names.length) {
    view.innerHTML = `<div class="empty muted">Нужно хотя бы 3 тренировки с упражнением, чтобы построить график.</div>`;
    return;
  }
  if (!state.progressEx || !names.includes(state.progressEx)) {
    state.progressEx = names.find(n => KEY_LIFTS.includes(n)) || names.find(n => E.exerciseMeta(n).kind !== 'warmup') || names[0];
  }
  const name = state.progressEx;
  const t = today();
  const all = E.sessionsFor(name, state.workouts).filter(s => s.best > 0);
  const from = state.progressRange ? E.addDays(t, -state.progressRange) : '0000';
  const ss = all.filter(s => s.date >= from);
  const best = all.reduce((m, s) => (s.best > m.best ? s : m), all[0]);
  const cur = E.currentE1rm(name, state.workouts, t);
  const tr = E.trend(name, state.workouts, t);

  view.innerHTML = `
    <h2>Прогресс</h2>
    <select id="progressEx" style="width:100%;margin-bottom:10px">
      ${names.map(n => `<option ${n === name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
    </select>
    <div class="chips">
      ${[[90, '3 мес'], [180, '6 мес'], [365, 'Год'], [0, 'Всё']].map(([v, l]) => `<button class="chip ${state.progressRange === v ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}
    </div>
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat"><div class="v">${cur ? Math.round(cur) : '—'}</div><div class="l">1ПМ сейчас, кг</div></div>
      <div class="stat"><div class="v">${best ? Math.round(best.best) : '—'}</div><div class="l">Рекорд${best ? ', ' + fmtDate(best.date, true).split(', ')[1] : ''}</div></div>
      <div class="stat"><div class="v">${tr ? pct(tr.change) : '—'}</div><div class="l">За 5 недель</div></div>
    </div>
    <div class="card">${chartSvg(ss)}</div>
    <div class="card tight">
      <h3>Последние тренировки</h3>
      <table class="list">
        <tr><th>Дата</th><th>Подходы</th><th class="num">1ПМ</th></tr>
        ${all.slice(-8).reverse().map(s => `<tr><td>${fmtDate(s.date, false)}</td><td class="small">${esc(E.formatSets(s.sets))}</td><td class="num">${Math.round(s.best)}</td></tr>`).join('')}
      </table>
    </div>
  `;
}

function chartSvg(ss) {
  if (ss.length < 2) return '<div class="muted small">Мало точек за этот период.</div>';
  const W = 360, H = 200, L = 30, R = 8, T = 8, B = 20;
  const xs = ss.map(s => E.parseISO(s.date).getTime());
  const ys = ss.map(s => s.best);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(2, (y1 - y0) * 0.1);
  y0 = Math.floor(y0 - pad); y1 = Math.ceil(y1 + pad);
  const X = x => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  // скользящее среднее по 5 точкам — показывает тренд без шума
  const ma = ys.map((_, i) => { const a = ys.slice(Math.max(0, i - 4), i + 1); return a.reduce((p, c) => p + c, 0) / a.length; });
  const grid = [0, 0.5, 1].map(f => { const v = y0 + (y1 - y0) * f; return `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
  const d0 = new Date(x0), d1 = new Date(x1);
  const lbl = d => `${MONTHS_RU[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="1ПМ по тренировкам">
      ${grid}
      ${ss.map((s, i) => `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="2.5" fill="var(--info)" opacity=".55"/>`).join('')}
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="${ma.map((v, i) => `${X(xs[i])},${Y(v)}`).join(' ')}"/>
      <text x="${L}" y="${H - 6}">${lbl(d0)}</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end">${lbl(d1)}</text>
    </svg>
    <div class="small muted">Точки — 1ПМ по лучшему подходу тренировки, линия — среднее по 5 тренировкам.</div>`;
}

// ---------- АНАЛИЗ ----------

const KEY_LIFTS = ['Bench Press · Barbell', 'Incline Bench Press · Barbell', 'Incline Bench Press · Dumbbell', 'Chest Dip',
  'Pull Up (Wide Grip)', 'Pull Up', 'Bent Over Row · Barbell', 'Overhead Press · Barbell', 'Curl · Barbell', 'Squat · Barbell'];

function renderAnalysis() {
  if (!state.workouts.length) {
    view.innerHTML = `<div class="empty muted">Анализ появится после импорта истории.</div>`;
    return;
  }
  const t = today();
  const lastDate = state.workouts[state.workouts.length - 1].date;
  const anchor = E.daysBetween(lastDate, t) > 14 ? lastDate : t;
  const freq = E.frequencyStats(state.workouts, anchor);
  const vol = E.weeklySetsByMuscle(state.workouts, anchor, 4);
  const maxV = Math.max(22, ...Object.values(vol));
  const zr = E.repZoneResponse(state.workouts, KEY_LIFTS, t);
  const zoneNames = { strength: 'Сила (1–6)', hypertrophy: 'Масса (7–11)', volume: 'Объём (12+)' };
  const zEntries = Object.entries(zr.zones).filter(([, z]) => z.n >= 5);
  const bestZone = zEntries.length ? zEntries.reduce((a, b) => (b[1].mean > a[1].mean ? b : a)) : null;

  const lifts = KEY_LIFTS.map(n => ({ n, e: E.currentE1rm(n, state.workouts, t), tr: E.trend(n, state.workouts, anchor, 56) })).filter(x => x.e);

  view.innerHTML = `
    <h2>Анализ</h2>
    ${anchor !== t ? `<p class="small muted">Последняя запись ${fmtDate(lastDate)}, поэтому считаю по 4 неделям до неё.</p>` : ''}
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat"><div class="v">${state.workouts.length}</div><div class="l">тренировок всего</div></div>
      <div class="stat"><div class="v">${freq.perWeek.toFixed(1)}</div><div class="l">в неделю (12 нед.)</div></div>
      <div class="stat"><div class="v">${freq.avgDuration ? Math.round(freq.avgDuration) : '—'}</div><div class="l">мин в среднем</div></div>
    </div>

    <div class="card">
      <h3>Рабочих подходов в неделю на мышцу</h3>
      <p class="small muted">Среднее за 4 недели. Зелёная зона — 10–20 подходов, это оптимум для массы.</p>
      ${Object.entries(vol).map(([m, v]) => {
        const color = v < 10 ? 'var(--warn)' : v > 22 ? 'var(--bad)' : 'var(--accent)';
        return `<div class="hbar"><span>${E.MUSCLE_LABELS[m]}</span>
          <div class="track"><div class="zone" style="left:${10 / maxV * 100}%;width:${10 / maxV * 100}%"></div><i style="width:${Math.min(100, v / maxV * 100)}%;background:${color}"></i></div>
          <span class="num">${v.toFixed(1)}</span></div>`;
      }).join('')}
    </div>

    <div class="card">
      <h3>Какие повторы давали тебе рост силы</h3>
      <p class="small muted">По всей истории основных упражнений: отрезки по 4 недели, где ты работал в основном в одном диапазоне, и как изменился 1ПМ за следующие 4 недели.</p>
      <table class="list">
        <tr><th>Диапазон</th><th class="num">Отрезков</th><th class="num">Изменение 1ПМ</th></tr>
        ${Object.entries(zr.zones).map(([k, z]) => `<tr><td>${zoneNames[k]}</td><td class="num">${z.n}</td><td class="num">${z.mean == null ? '—' : pct(z.mean)}</td></tr>`).join('')}
      </table>
      <p class="small" style="margin-bottom:0">${zoneConclusion(zEntries, bestZone)}</p>
    </div>

    <div class="card">
      <h3>Основные упражнения</h3>
      <table class="list">
        <tr><th>Упражнение</th><th class="num">1ПМ</th><th class="num">8 нед.</th></tr>
        ${lifts.map(x => `<tr><td>${esc(x.n)}</td><td class="num">${Math.round(x.e)}</td><td class="num">${x.tr ? `<span class="badge ${x.tr.status}">${pct(x.tr.change)}</span>` : '—'}</td></tr>`).join('')}
      </table>
    </div>
  `;
}

function zoneConclusion(zEntries, bestZone) {
  if (!bestZone) return 'Пока мало данных для вывода.';
  const allFlat = zEntries.every(([, z]) => Math.abs(z.mean) < 0.01);
  if (allFlat) {
    return 'Ни один диапазон сам по себе не давал роста: сила почти не менялась при любых повторах. Значит, дело не в повторах, а в отсутствии системы прогрессии. Именно это и исправляют блоки: каждая неделя со своей целью и вес, который растёт вслед за 1ПМ.';
  }
  const names = { strength: 'малых', hypertrophy: 'средних', volume: 'больших' };
  return `Лучше всего тебе заходили отрезки с упором на ${names[bestZone[0]]} повторы (${pct(bestZone[1].mean)} за 4 недели). Это наблюдение, а не точный эксперимент: через 2–3 блока в приложении вывод станет надёжнее.`;
}

// ---------- НАСТРОЙКИ ----------

function renderSettings() {
  const s = state.settings;
  const ph = E.phaseFor(today(), s);
  const options = knownNames().map(n => `<option value="${esc(n)}">`).join('');
  const days = Object.entries(state.templates).sort(([a], [b]) => ((+a + 6) % 7) - ((+b + 6) % 7));
  const freeDays = [1, 2, 3, 4, 5, 6, 0].filter(d => !state.templates[d]);
  view.innerHTML = `
    <h2>Настройки</h2>
    <div class="card">
      <h3>Периодизация</h3>
      <p class="small muted">Блок из 4 недель: ${s.phaseOrder.map(k => E.PHASES[k].label).join(' → ')}. Сейчас: блок ${ph.blockNo}, неделя ${ph.weekInBlock}, «${ph.phase.label}».</p>
      <label class="field"><span>Начало блока (понедельник)</span><input type="date" id="blockStart" value="${s.blockStart}"></label>
      <button class="block" data-act="block-now">Начать новый блок с этой недели</button>
      <label class="field"><span>Эта неделя</span>
        <select id="phaseOverride">
          <option value="">Авто (${E.PHASES[s.phaseOrder[ph.weekInBlock - 1]].label})</option>
          ${Object.entries(E.PHASES).map(([k, p]) => `<option value="${k}" ${s.phaseOverride?.week === ph.weekStart && s.phaseOverride.key === k ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Порядок недель в блоке</span>
        <select id="phaseOrder">
          ${[['volume', 'hypertrophy', 'strength', 'deload'], ['strength', 'volume', 'hypertrophy', 'deload'], ['hypertrophy', 'volume', 'strength', 'deload']]
            .map(o => `<option value="${o.join(',')}" ${o.join(',') === s.phaseOrder.join(',') ? 'selected' : ''}>${o.map(k => E.PHASES[k].label).join(' → ')}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Вес тела, кг (для подтягиваний и брусьев)</span><input type="number" inputmode="decimal" step="0.1" id="bodyweight" value="${s.bodyweight}"></label>
    </div>

    <div class="card">
      <h3>Дни и упражнения</h3>
      <datalist id="exNames">${options}</datalist>
      ${days.map(([d, t]) => `
        <div style="margin:12px 0 4px" class="row between">
          <b>${E.WEEKDAYS[d]}</b>
          <input value="${esc(t.title)}" data-tpl-title="${d}" style="flex:1">
          <button class="small ghost danger" data-act="del-day" data-day="${d}" aria-label="Удалить день">✕</button>
        </div>
        ${t.exercises.map((n, i) => `
          <div class="tpl-item"><span>${esc(n)}</span>
            <button class="small ghost" data-act="tpl-up" data-day="${d}" data-i="${i}" aria-label="Выше">↑</button>
            <button class="small ghost" data-act="tpl-del" data-day="${d}" data-i="${i}" aria-label="Убрать">✕</button>
          </div>`).join('')}
        <div class="row" style="margin-top:6px">
          <input class="grow" list="exNames" placeholder="Добавить упражнение" data-tpl-add="${d}">
          <button class="small" data-act="tpl-add" data-day="${d}">+</button>
        </div>`).join('')}
      ${freeDays.length ? `
        <div class="row" style="margin-top:14px">
          <select id="newDay">${freeDays.map(d => `<option value="${d}">${E.WEEKDAYS[d]}</option>`).join('')}</select>
          <button class="small" data-act="add-day">Добавить день</button>
        </div>` : ''}
      <button class="small ghost" style="margin-top:10px" data-act="reset-tpl">Вернуть программу по умолчанию</button>
    </div>

    <div class="card">
      <h3>Данные</h3>
      <p class="small muted">Всё хранится только на этом телефоне. Делай резервную копию раз в неделю-две.</p>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <button data-act="import-txt">Импортировать TXT из GymKeeper</button>
        <button data-act="export-json">Скачать резервную копию (JSON)</button>
        <button data-act="import-json">Восстановить из резервной копии</button>
        <button class="danger" data-act="wipe">Удалить все данные</button>
      </div>
    </div>
    <p class="small muted">ИИ-советы (Claude) подключим следующим шагом: сейчас все расчёты делает код прямо в телефоне, без интернета.</p>
  `;
}

// ---------- импорт и экспорт ----------

function importTxt(text) {
  const { workouts } = parseGymKeeperTxt(text);
  if (!workouts.length) { toast('В файле не нашлось тренировок'); return; }
  // импортированные заменяем целиком, свои тренировки из приложения не трогаем
  const own = state.workouts.filter(w => w.source !== 'import');
  state.workouts = [...workouts, ...own];
  persistWorkouts();
  toast(`Импортировано ${workouts.length} тренировок`);
  render();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportJson() {
  download(`gymcoach-${today()}.json`, JSON.stringify({
    app: 'gymcoach', version: 1, exportedAt: new Date().toISOString(),
    workouts: state.workouts, settings: state.settings, templates: state.templates,
  }));
}

function importJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast('Это не файл резервной копии'); return; }
  if (data.app !== 'gymcoach' || !Array.isArray(data.workouts)) { toast('Это не файл резервной копии GymCoach'); return; }
  if (!confirm(`Заменить текущие данные копией от ${String(data.exportedAt).slice(0, 10)} (${data.workouts.length} тренировок)?`)) return;
  state.workouts = data.workouts;
  state.settings = { ...E.DEFAULT_SETTINGS, ...data.settings };
  state.templates = data.templates || E.DEFAULT_TEMPLATES;
  persistWorkouts();
  save(KEYS.settings, state.settings);
  save(KEYS.templates, state.templates);
  toast('Восстановлено');
  render();
}

const fileTxt = document.getElementById('fileTxt');
const fileJson = document.getElementById('fileJson');
fileTxt.addEventListener('change', async () => {
  const f = fileTxt.files[0];
  if (f) importTxt(await f.text());
  fileTxt.value = '';
});
fileJson.addEventListener('change', async () => {
  const f = fileJson.files[0];
  if (f) importJson(await f.text());
  fileJson.value = '';
});

// ---------- события ----------

function saveTemplates() { save(KEYS.templates, state.templates); }
function saveSettings() { save(KEYS.settings, state.settings); renderPhasePill(); }

view.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const { act } = b.dataset;
  const i = b.dataset.i != null ? +b.dataset.i : null;
  const day = b.dataset.day;

  if (b.dataset.range != null) { state.progressRange = +b.dataset.range; renderProgress(); return; }
  if (b.classList.contains('chip') && day != null) { state.pickDay = +day; renderToday(); return; }

  switch (act) {
    case 'start': startSession(+day); break;
    case 'toggle-set': toggleSet(i, +b.dataset.j); break;
    case 'add-set': {
      const it = state.draft.items[i];
      const last = it.sets[it.sets.length - 1];
      it.sets.push({ w: last?.w ?? it.plan.weight, r: last?.r ?? it.plan.targetReps, rir: it.plan.rir, done: false, edited: false });
      save(KEYS.draft, state.draft); renderSession(); break;
    }
    case 'del-set': state.draft.items[i].sets.pop(); save(KEYS.draft, state.draft); renderSession(); break;
    case 'remove-ex':
      if (state.draft.items[i].sets.some(s => s.done) && !confirm('В упражнении есть выполненные подходы. Убрать?')) return;
      state.draft.items.splice(i, 1); save(KEYS.draft, state.draft); renderSession(); break;
    case 'add-ex': {
      const raw = document.getElementById('addExName').value.trim();
      if (!raw) return;
      const name = normalizeName(raw);
      const p = { ...E.prescribe(name, state.draft.phaseKey, state.workouts, state.settings, today()), trend: E.trend(name, state.workouts, today()) };
      state.draft.items.push(makeItem(p));
      save(KEYS.draft, state.draft); renderSession(); break;
    }
    case 'cancel':
      if (confirm('Отменить тренировку? Отмеченные подходы не сохранятся.')) {
        state.draft = null; save(KEYS.draft, null); stopTimer(); releaseWakeLock(); render();
      }
      break;
    case 'finish': finishSession(); break;
    case 'more-history': state.historyLimit += 30; renderHistory(); break;
    case 'del-workout':
      if (confirm('Удалить эту тренировку из истории?')) {
        state.workouts = state.workouts.filter(w => w.id !== b.dataset.id); persistWorkouts(); renderHistory();
      }
      break;
    case 'import-txt': fileTxt.click(); break;
    case 'import-json': fileJson.click(); break;
    case 'export-json': exportJson(); break;
    case 'wipe':
      if (confirm('Удалить ВСЕ тренировки и настройки с этого телефона? Это нельзя отменить.')) {
        Object.values(KEYS).forEach(k => save(k, null)); location.reload();
      }
      break;
    case 'block-now':
      state.settings.blockStart = E.mondayOf(today()); state.settings.phaseOverride = null; saveSettings(); renderSettings();
      toast('Новый блок начат с этой недели'); break;
    case 'tpl-del': state.templates[day].exercises.splice(i, 1); saveTemplates(); renderSettings(); break;
    case 'tpl-up': {
      if (i === 0) return;
      const ex = state.templates[day].exercises;
      [ex[i - 1], ex[i]] = [ex[i], ex[i - 1]]; saveTemplates(); renderSettings(); break;
    }
    case 'tpl-add': {
      const inp = view.querySelector(`[data-tpl-add="${day}"]`);
      const v = inp.value.trim();
      if (!v) return;
      state.templates[day].exercises.push(normalizeName(v)); saveTemplates(); renderSettings(); break;
    }
    case 'del-day':
      if (confirm(`Удалить день ${E.WEEKDAYS[day]} из программы?`)) { delete state.templates[day]; saveTemplates(); renderSettings(); }
      break;
    case 'add-day': {
      const d = document.getElementById('newDay').value;
      state.templates[d] = { title: 'Новая тренировка', exercises: [] }; saveTemplates(); renderSettings(); break;
    }
    case 'reset-tpl':
      if (confirm('Вернуть программу по умолчанию? Твои правки дней пропадут.')) {
        state.templates = structuredClone(E.DEFAULT_TEMPLATES); saveTemplates(); renderSettings();
      }
      break;
  }
});

view.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f && state.draft) {
    const s = state.draft.items[+el.dataset.i].sets[+el.dataset.j];
    s[el.dataset.f] = el.value === '' ? '' : +el.value;
    if (el.dataset.f === 'w') s.edited = true;
    save(KEYS.draft, state.draft);
  }
  if (el.dataset.tplTitle != null) { state.templates[el.dataset.tplTitle].title = el.value; saveTemplates(); }
});

view.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'progressEx') { state.progressEx = el.value; renderProgress(); }
  if (el.id === 'bodyweight') { state.settings.bodyweight = +el.value || 72; saveSettings(); }
  if (el.id === 'blockStart' && el.value) { state.settings.blockStart = E.mondayOf(el.value); saveSettings(); renderSettings(); }
  if (el.id === 'phaseOrder') { state.settings.phaseOrder = el.value.split(','); saveSettings(); renderSettings(); }
  if (el.id === 'phaseOverride') {
    const ph = E.phaseFor(today(), { ...state.settings, phaseOverride: null });
    state.settings.phaseOverride = el.value ? { week: ph.weekStart, key: el.value } : null;
    saveSettings(); renderSettings();
  }
});

document.getElementById('timer').addEventListener('click', e => {
  const v = e.target.closest('button')?.dataset.timer;
  if (!v || !timer) return;
  if (v === 'stop') stopTimer();
  else { timer.end += +v * 1000; timer.total = Math.max(timer.total, (timer.end - Date.now()) / 1000); tickTimer(); }
});

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

function render() {
  renderPhasePill();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  ({ today: renderToday, history: renderHistory, progress: renderProgress, analysis: renderAnalysis, settings: renderSettings })[state.tab]();
}

render();
if (state.draft) requestWakeLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
