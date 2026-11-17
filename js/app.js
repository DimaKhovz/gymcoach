import { parseGymKeeperTxt, normalizeName } from './parser.js';
import * as E from './engine.js';
import { initMedia, mediaFor, stepsFor, setPick, searchDb, bundledNames, appNameFor, customNames, customInfo, saveCustom, shrinkPhoto, norm, stem, CUSTOM_KEY } from './media.js';
import { L, LANG, setLang, dayTitle, exName } from './i18n.js';

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
    toast(L('Не удалось сохранить: ', 'Could not save: ') + e.message);
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
if ((state.settings.programVersion || 1) < E.PROGRAM_VERSION) {
  // новая программа под график Вт/Чт/Сб/Вс; свои правки дней (если были) не трогаем
  const hasOwnApp = state.workouts.some(w => w.source === 'app');
  if (!hasOwnApp && state.settings.blockStart >= E.mondayOf(today())) {
    // эту неделю доделываем как привык, блок 1 — с понедельника
    const thisWeek = E.mondayOf(today());
    state.settings.blockStart = E.addDays(thisWeek, 7);
    state.settings.phaseOverride = { week: thisWeek, key: 'hypertrophy' };
  }
  state.settings.programVersion = E.PROGRAM_VERSION;
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
function animThumb(name, cls = '') {
  const m = mediaFor(name);
  if (!m) return `<button class="anim empty-anim ${cls}" data-act="pick-media" data-name="${esc(name)}" aria-label="${L('Выбрать картинку', 'Choose a picture')}">＋<small>${L('картинка', 'picture')}</small></button>`;
  return `<button class="anim ${cls}" data-act="media" data-name="${esc(name)}" aria-label="${L('Техника', 'Technique')}: ${esc(exName(name))}">
    <img src="${esc(m.frames[0])}" alt="" loading="lazy"><img class="f2" src="${esc(m.frames[1])}" alt="" loading="lazy"></button>`;
}
const fmtW = w => (w == null ? '—' : E.fmtW(w));
const pct = x => (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const MONTHS = L(['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
function fmtDate(iso, withYear = true) {
  const d = E.parseISO(iso);
  return `${E.WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
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

function trendBadge(t, e) {
  if (!e) return `<span class="badge new">${L('нет истории', 'no history')}</span>`;
  if (!t) return '';
  const label = L({ up: 'растёт', plateau: 'плато', down: 'падает' }, { up: 'rising', plateau: 'plateau', down: 'falling' })[t.status];
  return `<span class="badge ${t.status}" title="${L('Лучший 1ПМ за 5 недель против 5 недель до этого', 'Best 1RM over 5 weeks vs the 5 weeks before')}">${label} ${pct(t.change)}</span>`;
}

// ---------- фаза в шапке ----------

function renderPhasePill() {
  const p = E.phaseFor(today(), state.settings);
  document.getElementById('phasePill').innerHTML = p.blockNo < 1
    ? `<span class="dot" style="background:${p.phase.color}"></span>${L('До старта блока', 'Before block start')} · ${p.phase.label}`
    : `<span class="dot" style="background:${p.phase.color}"></span>${L('Блок', 'Block')} ${p.blockNo} · ${p.weekInBlock}/${p.blockLen} · ${p.phase.label}`;
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
  const kg = L('кг', 'kg');
  if (p.warmup) return L(`Разминка: <b>${p.sets} × ${p.reps[0]}–${p.reps[1]}</b>, без отказа`, `Warm-up: <b>${p.sets} × ${p.reps[0]}–${p.reps[1]}</b>, not to failure`);
  if (p.skill) {
    const sw = p.weight == null ? L('лёгкий вес', 'light weight') : `${fmtW(p.weight)} ${kg}`;
    return L(`Техника: <b>${p.sets} × ${p.reps[0]}–${p.reps[1]}</b> · <b>${sw}</b> · далеко от отказа · отдых ${fmtSec(p.rest)}`,
      `Technique: <b>${p.sets} × ${p.reps[0]}–${p.reps[1]}</b> · <b>${sw}</b> · far from failure · rest ${fmtSec(p.rest)}`);
  }
  const reps = `${p.reps[0]}–${p.reps[1]}`;
  let w;
  if (p.weight == null) w = L('вес подбери сам', 'pick the weight yourself');
  else if (p.meta.equip === 'bodyweight') {
    const add = p.weight - state.settings.bodyweight;
    w = add > 0 ? `+${fmtW(add)} ${kg}` : L('свой вес', 'bodyweight');
  } else w = `${fmtW(p.weight)} ${kg}`;
  const reptarget = p.bodyweightOnly && p.meta.kind === 'compound'
    ? L(`по ${p.targetReps}`, `${p.targetReps} each`)
    : L(`${reps} (цель ${p.targetReps})`, `${reps} (target ${p.targetReps})`);
  return `<b>${p.sets} × ${reptarget}</b> · <b>${w}</b> · ${L(`${p.rir} в запасе`, `${p.rir} in reserve`)} · ${L('отдых', 'rest')} ${fmtSec(p.rest)}`;
}

function renderToday() {
  if (state.draft) return renderSession();
  requestAnimationFrame(() => view.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const hasData = state.workouts.length > 0;
  const nt = nextTrainingDay();
  const dayKey = state.pickDay ?? nt.day;
  const { ph, tpl, plans } = planFor(dayKey);
  const tips = E.adviceForToday({ plans: plans.map(p => ({ ...p, name: exName(p.name) })), phaseInfo: ph, workouts: state.workouts, today: today(), settings: state.settings });

  const chips = Object.entries(state.templates)
    .sort(([a], [b]) => ((+a + 6) % 7) - ((+b + 6) % 7))
    .map(([k, t]) => `<button class="chip ${+k === +dayKey ? 'on' : ''}" data-day="${k}">${E.WEEKDAYS[k]} · ${esc(dayTitle(t.title))}</button>`)
    .join('');

  const when = state.pickDay == null
    ? (nt.inDays === 0 ? L('Сегодня по плану', 'Planned for today') : nt.inDays === 1 ? L('Завтра по плану', 'Planned for tomorrow') : L(`Ближайшая тренировка через ${nt.inDays} дн.`, `Next workout in ${nt.inDays} days`))
    : L('Выбрана тренировка', 'Selected workout');

  view.innerHTML = `
    ${hasData ? '' : `
      <div class="card">
        <h3>${L('Загрузи свою историю', 'Load your history')}</h3>
        <p class="muted small">${L('В GymKeeper: Настройки → Экспорт → TXT. Потом выбери этот файл здесь. По истории приложение посчитает рабочие веса.', 'In GymKeeper: Settings → Export → TXT. Then pick that file here. The app will work out your working weights from your history.')}</p>
        <button class="primary block" data-act="import-txt">${L('Импортировать TXT из GymKeeper', 'Import TXT from GymKeeper')}</button>
      </div>`}
    ${backupReminder()}
    <div class="chips">${chips}</div>
    <div class="card">
      <div class="small muted">${when}</div>
      <h2 style="margin:2px 0 10px">${esc(dayTitle(tpl?.title || 'Тренировка'))}</h2>
      <ul class="tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    ${plans.map((p, i) => `
      <div class="card tight ${tpl?.linked?.[i] || tpl?.linked?.[i - 1] ? 'linked' : ''}">
        <div class="ex-head">
          ${animThumb(p.name)}
          <div class="grow">
            <div class="ex-name">${esc(exName(p.name))}</div>
            ${p.warmup ? '' : trendBadge(p.trend, p.e1rm)}
          </div>
          ${i > 0 ? `<button class="ghost small" data-act="tpl-up" data-day="${dayKey}" data-i="${i}" aria-label="${L('Выше', 'Move up')}">↑</button>` : ''}
          <button class="ghost small" data-act="tpl-del" data-day="${dayKey}" data-i="${i}" aria-label="${L('Убрать упражнение', 'Remove exercise')}">✕</button>
        </div>
        <div class="target">${targetText(p)}</div>
        ${p.meta.note ? `<div class="note small">${esc(p.meta.note)}</div>` : ''}
        <div class="small muted">${p.last ? `${L('Прошлый раз', 'Last time')} (${fmtDate(p.last.date, false)}): ${esc(E.formatSets(p.last.sets))}` : L('Ещё не делал', 'Not done yet')}
        ${p.e1rm ? ` · ${L('1ПМ', '1RM')} ≈ ${Math.round(p.e1rm)} ${L('кг', 'kg')}` : ''}</div>
      </div>
      ${i < plans.length - 1 ? linkBtn('tpl-link', i, !!tpl?.linked?.[i], dayKey) : ''}`).join('')}
    ${tpl ? `<button class="block add-ex-btn" data-act="tpl-add" data-day="${dayKey}">＋ ${L('Добавить упражнение', 'Add exercise')}</button>
    <p class="small muted" style="margin:-4px 0 12px">${L(`Изменения сохраняются в программу на ${E.WEEKDAYS[dayKey]}: следующие тренировки этого дня будут такими же.`, `Changes are saved to the ${E.WEEKDAYS[dayKey]} program: future workouts on this day will be the same.`)}</p>` : ''}
    <button class="primary block" data-act="start" data-day="${dayKey}">${L('Начать тренировку', 'Start workout')}</button>
    <p class="small muted" style="margin-top:12px">${L('Вес считается от твоего 1ПМ (лучшее из последних 3 тренировок, формула Эпли) под нужные повторы с запасом. Во время тренировки следующие подходы подстраиваются под то, как прошёл предыдущий.', 'Weights are calculated from your 1RM (best of your last 3 workouts, Epley formula) for the target reps with reps in reserve. During the workout, the next sets adjust to how the previous one went.')}</p>
  `;
}

// Кнопка между упражнениями: связать в суперсет / круг (без отдыха до следующего упражнения).
function linkBtn(act, i, on, day = '') {
  return `<button class="link-btn ${on ? 'on' : ''}" data-act="${act}" data-i="${i}" ${day !== '' ? `data-day="${day}"` : ''}>${on
    ? L('⛓ суперсет: сразу к следующему, без отдыха', '⛓ superset: go straight to the next one')
    : L('＋ связать в суперсет', '＋ link as a superset')}</button>`;
}

function backupStatusText() {
  const age = backupAgeDays();
  if (age == null) return L('⚠️ Резервной копии ещё не было.', '⚠️ No backup yet.');
  const when = age === 0 ? L('сегодня', 'today') : age === 1 ? L('вчера', 'yesterday') : L(`${age} дн. назад`, `${age} days ago`);
  return `${age > 7 ? '⚠️' : '✅'} ${L('Последняя копия', 'Last backup')}: ${when}.`;
}

// Напоминаем, если есть что терять, а копии не было больше 7 дней (не чаще раза в день).
function backupReminder() {
  const own = state.workouts.filter(w => w.source === 'app').length;
  if (!state.workouts.length) return '';
  const age = backupAgeDays();
  if (age != null && age <= 7) return '';
  if (age == null && own === 0) return '';
  if (load('gc.backupSnooze', null) === today()) return '';
  return `
    <div class="card backup-card">
      <b>${age == null ? L('Сделай первую резервную копию', 'Make your first backup') : L(`Копии не было ${age} дн.`, `No backup for ${age} days`)}</b>
      <p class="small muted" style="margin:4px 0 10px">${L('Тренировки хранятся только на телефоне. Отправь копию себе в Telegram или на Google Диск: это одно нажатие.', 'Your workouts are stored only on this phone. Send a backup to yourself in Telegram or Google Drive: it takes one tap.')}</p>
      <div class="row">
        <button class="primary small" data-act="share-backup">${L('Поделиться копией', 'Share backup')}</button>
        <button class="ghost small" data-act="backup-later">${L('Позже', 'Later')}</button>
      </div>
    </div>`;
}

function startSession(dayKey) {
  const { ph, tpl, plans } = planFor(dayKey);
  state.draft = {
    date: today(),
    startedAt: Date.now(),
    dayKey,
    title: tpl?.title || 'Тренировка',
    phaseKey: ph.key,
    items: plans.map((p, idx) => makeItem(p, idx < plans.length - 1 && !!tpl?.linked?.[idx])),
  };
  save(KEYS.draft, state.draft);
  requestWakeLock();
  render();
  window.scrollTo(0, 0);
}

function makeItem(p, link = false) {
  const { trend, last, ...plan } = p;
  return {
    name: p.name,
    link,
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

  view.innerHTML = `
    <div class="card tight">
      <div class="row between">
        <div>
          <div class="small muted">${fmtDate(d.date)} · ${mins} ${L('мин', 'min')} · ${doneSets} ${L('подх.', 'sets')}</div>
          <h3 style="margin:2px 0 0">${esc(dayTitle(d.title))}</h3>
        </div>
        <span class="pill"><span class="dot" style="background:${ph.color}"></span>${ph.label}</span>
      </div>
    </div>
    ${d.items.map((it, i) => renderItem(it, i) + (i < d.items.length - 1 ? linkBtn('ses-link', i, !!it.link) : '')).join('')}
    <button class="block add-ex-btn" data-act="open-add">＋ ${L('Добавить упражнение', 'Add exercise')}</button>
    <div class="row" style="gap:10px">
      <button class="danger grow" data-act="cancel">${L('Отменить', 'Cancel')}</button>
      <button class="primary grow" data-act="finish">${L('Завершить и сохранить', 'Finish and save')}</button>
    </div>
  `;
}

function renderItem(it, i) {
  const p = it.plan;
  const isBw = p.meta.equip === 'bodyweight';
  const linked = it.link || state.draft.items[i - 1]?.link;
  const rows = it.sets.map((s, j) => `
    <tr class="${s.done ? 'done' : ''} ${s.drop ? 'drop' : ''}">
      <td class="n">${s.drop ? `<span title="${L('дроп-сет: сразу после предыдущего, без отдыха', 'drop set: right after the previous one, no rest')}">↓</span>` : j + 1}</td>
      <td><input type="number" inputmode="decimal" step="any" value="${s.w ?? ''}" data-i="${i}" data-j="${j}" data-f="w" placeholder="${L('кг', 'kg')}"></td>
      <td><input type="number" inputmode="numeric" value="${s.r ?? ''}" data-i="${i}" data-j="${j}" data-f="r"></td>
      <td><select data-i="${i}" data-j="${j}" data-f="rir">${[0, 1, 2, 3, 4].map(v => `<option value="${v}" ${+s.rir === v ? 'selected' : ''}>${v === 4 ? '4+' : v}</option>`).join('')}</select></td>
      <td class="ok"><button class="check" data-act="toggle-set" data-i="${i}" data-j="${j}" aria-label="${L('Подход выполнен', 'Set done')}">✓</button></td>
    </tr>`).join('');
  return `
    <div class="card tight ${linked ? 'linked' : ''}">
      <div class="ex-head">
        ${animThumb(it.name)}
        <div class="ex-name grow">${esc(exName(it.name))}</div>
        <button class="ghost small" data-act="remove-ex" data-i="${i}" aria-label="${L('Убрать упражнение', 'Remove exercise')}">✕</button>
      </div>
      <div class="target">${targetText(p)}</div>
      ${p.meta.note ? `<div class="note small">${esc(p.meta.note)}</div>` : ''}
      ${it.lastText ? `<div class="small muted">${L('Прошлый раз', 'Last time')} ${esc(it.lastText)}</div>` : ''}
      <table class="sets">
        <thead><tr><th></th><th>${isBw ? L('Вес с телом', 'Incl. body') : L('Вес', 'Weight')}</th><th>${L('Повт.', 'Reps')}</th><th>${L('В запасе', 'RIR')}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="row" style="margin-top:6px">
        <button class="small" data-act="add-set" data-i="${i}">+ ${L('подход', 'set')}</button>
        ${p.warmup || p.skill ? '' : `<button class="small" data-act="add-drop" data-i="${i}" title="${L('Снял вес и сразу продолжил', 'Lighter weight right away, no rest')}">+ ${L('дроп', 'drop')}</button>`}
        ${it.sets.length > 1 ? `<button class="small ghost" data-act="del-set" data-i="${i}">− ${L('подход', 'set')}</button>` : ''}
      </div>
    </div>`;
}

// Суперсет / круг: соседние упражнения, связанные цепочкой (item.link = «без отдыха к следующему»).
function chainOf(i) {
  const items = state.draft.items;
  let a = i, b = i;
  while (a > 0 && items[a - 1].link) a--;
  while (b < items.length - 1 && items[b].link) b++;
  return { start: a, end: b };
}
const itemTitle = it => mediaFor(it.name)?.title || exName(it.name);

function toggleSet(i, j) {
  const items = state.draft.items;
  const it = items[i];
  const s = it.sets[j];
  s.done = !s.done;
  if (s.done && !s.drop && s.w && s.r && !it.plan.warmup && !it.plan.skill) {
    // подстраиваем следующие обычные подходы, которые ты не правил руками (дропы не трогаем)
    const next = E.adjustedWeight(it.plan, { w: +s.w, r: +s.r, rir: +s.rir }, state.settings);
    for (const n of it.sets.slice(j + 1)) {
      if (!n.done && !n.edited && !n.drop) n.w = next;
    }
  }
  if (s.done) {
    const ch = chainOf(i);
    const nextSet = it.sets[j + 1];
    if (nextSet?.drop && !nextSet.done) {
      // дроп-сет: без отдыха, только снять вес
      stopTimer();
      toast(L(`Сразу дроп: ${fmtW(+nextSet.w)} кг`, `Drop right away: ${fmtW(+nextSet.w)} kg`));
    } else if (it.link && i < ch.end) {
      // суперсет: сразу к следующему упражнению цепочки
      stopTimer();
      toast(L('Сразу: ', 'Next, no rest: ') + itemTitle(items[i + 1]));
      requestAnimationFrame(() => view.querySelectorAll('.card.tight')[i + 2]?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    } else if (ch.end > ch.start) {
      // конец круга: отдых, потом снова первое упражнение цепочки
      const rest = Math.min(...items.slice(ch.start, ch.end + 1).map(x => x.plan.rest || 90));
      const first = items.slice(ch.start, ch.end + 1).find(x => x.sets.some(z => !z.done));
      startTimer(rest, first ? `${L('новый круг', 'next round')}: ${itemTitle(first)}` : nextUpLabel(i, j));
    } else {
      startTimer(it.plan.rest || 90, nextUpLabel(i, j));
    }
  }
  save(KEYS.draft, state.draft);
  renderSession();
}

function finishSession() {
  const d = state.draft;
  const exercises = d.items
    .map(it => ({
      name: it.name,
      sets: it.sets.filter(s => s.done && s.w !== '' && s.r).map(s => ({
        w: +s.w, r: +s.r, rir: +s.rir, ...(it.plan.warmup ? { flag: 'warmup' } : s.drop ? { flag: 'drop' } : {}),
      })),
      ...(it.link ? { superset: true } : {}),
    }))
    .filter(ex => ex.sets.length);
  if (!exercises.length) {
    if (!confirm(L('Нет отмеченных подходов. Выйти без сохранения?', 'No sets checked. Exit without saving?'))) return;
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
    const nSets = exercises.reduce((n, e) => n + e.sets.length, 0);
    toast(L(`Сохранено: ${exercises.length} упр., ${nSets} подходов`, `Saved: ${exercises.length} exercises, ${nSets} sets`));
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
// Что делать после отдыха: следующий невыполненный подход этого упражнения или следующее упражнение.
function nextUpLabel(i, j) {
  const items = state.draft.items;
  for (let a = i; a < items.length; a++) {
    const from = a === i ? j + 1 : 0;
    const k = items[a].sets.findIndex((x, idx) => idx >= from && !x.done);
    if (k >= 0) {
      const title = mediaFor(items[a].name)?.title || exName(items[a].name);
      const st = items[a].sets[k];
      return `${title}, ${L('подход', 'set')} ${k + 1}${st.w ? ` · ${fmtW(+st.w)} ${L('кг', 'kg')} × ${st.r}` : ''}`;
    }
  }
  return L('Все подходы выполнены — можно завершать', 'All sets done — you can finish');
}

function startTimer(sec, nextUp = '') {
  timer = { end: Date.now() + sec * 1000, total: sec, buzzed: false, nextUp };
  document.body.classList.add('timer-on');
  // старый сигнал «Отдых закончен» убираем сами: смахнутые вручную уведомления
  // Chrome считает нежелательными и может начать помечать сайт как спам
  closeRestNote().then(notifyRestStart);
  tickTimer();
}

// ---------- уведомления на часы ----------
// Часы Amazfit получают уведомления телефона через Zepp и вибрируют.
// На Android уведомления из веб-приложения показываются только через service worker.

function notifyEnabled() {
  return state.settings.watchNotify && 'Notification' in window && Notification.permission === 'granted';
}
async function showNote(title, body, { silent = false } = {}) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return false;
    await reg.showNotification(title, {
      body, tag: 'gc-rest', renotify: !silent, silent,
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      vibrate: silent ? undefined : [300, 150, 300, 150, 300],
    });
    return true;
  } catch { return false; }
}
function clockText(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
function notifyRestStart() {
  if (!timer || !notifyEnabled() || !state.settings.watchNotifyStart) return;
  showNote(L(`Отдых ${fmtSec(timer.total)} — до ${clockText(timer.end)}`, `Rest ${fmtSec(timer.total)} — until ${clockText(timer.end)}`), `${L('Дальше', 'Next')}: ${timer.nextUp}`);
}
function notifyRestEnd() {
  if (!timer || !notifyEnabled()) return;
  const t = timer;
  showNote(L('Отдых закончен — подход!', 'Rest is over — next set!'), `${L('Дальше', 'Next')}: ${timer.nextUp}`);
  // часы уже завибрировали; через 90 секунд уведомление само исчезает с телефона
  setTimeout(() => { if (timer === t || !timer) closeRestNote(); }, 90000);
}
async function closeRestNote() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    (await reg?.getNotifications({ tag: 'gc-rest' }))?.forEach(n => n.close());
  } catch { /* не важно */ }
}

async function enableWatchNotify() {
  if (!('Notification' in window)) { toast(L('Этот браузер не умеет показывать уведомления', 'This browser can\'t show notifications')); return false; }
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast(L('Уведомления запрещены. Разреши их: Настройки Android → Приложения → GymCoach → Уведомления', 'Notifications are blocked. Allow them: Android Settings → Apps → GymCoach → Notifications'));
    return false;
  }
  return true;
}
function stopTimer() {
  timer = null;
  closeRestNote();
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
    notifyRestEnd();
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

const FLAG_LABEL = L({ warmup: 'разминка', drop: 'дроп', hard: 'тяжело' }, { warmup: 'warm-up', drop: 'drop', hard: 'hard' });

function renderHistory() {
  const list = [...state.workouts].reverse();
  if (!list.length) {
    view.innerHTML = `<div class="empty muted">${L('Пока пусто. Импортируй дневник в настройках или проведи первую тренировку.', 'Nothing here yet. Import your diary in Settings or do your first workout.')}</div>`;
    return;
  }
  const shown = list.slice(0, state.historyLimit);
  view.innerHTML = `
    <h2>${L('История', 'History')} <span class="muted small">${list.length} ${L('тренировок', 'workouts')}</span></h2>
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
          <div class="small muted">${w.exercises.length} ${L('упр.', 'ex.')} · ${sets} ${L('подх.', 'sets')}${w.duration ? ` · ${w.duration} ${L('мин', 'min')}` : ''} · ${esc(w.exercises.slice(0, 3).map(e => exName(e.name).split(' · ')[0]).join(', '))}${w.exercises.length > 3 ? '…' : ''}</div>
        </summary>
        <div class="body">
          ${w.exercises.map(e => `
            <div class="ex-line"><div>${esc(exName(e.name))}${e.superset ? ` <span class="muted small">⛓ ${L('суперсет со следующим', 'superset with next')}</span>` : ''}</div>
            <div class="sets-txt">${e.sets.map(s => s.raw ? esc(s.raw) : `${fmtW(s.w)}×${s.r}${s.flag ? ` <i>${esc(FLAG_LABEL[s.flag] || s.flag)}</i>` : ''}${s.rir != null ? ` <span title="${L('в запасе', 'reps in reserve')}">(${s.rir})</span>` : ''}`).join(' · ')}</div></div>`).join('')}
          ${w.note ? `<div class="small muted">${esc(w.note)}</div>` : ''}
          <div class="row" style="margin-top:8px"><button class="small danger" data-act="del-workout" data-id="${esc(w.id)}">${L('Удалить тренировку', 'Delete workout')}</button></div>
        </div>
      </details>`;
    }).join('')}
    ${list.length > shown.length ? `<button class="block" data-act="more-history">${L('Показать ещё', 'Show more')}</button>` : ''}
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
    view.innerHTML = `<div class="empty muted">${L('Нужно хотя бы 3 тренировки с упражнением, чтобы построить график.', 'You need at least 3 workouts with an exercise to draw a chart.')}</div>`;
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
  const ranges = [[90, L('3 мес', '3 mo')], [180, L('6 мес', '6 mo')], [365, L('Год', 'Year')], [0, L('Всё', 'All')]];

  view.innerHTML = `
    <h2>${L('Прогресс', 'Progress')}</h2>
    <select id="progressEx" style="width:100%;margin-bottom:10px">
      ${names.map(n => `<option value="${esc(n)}" ${n === name ? 'selected' : ''}>${esc(exName(n))}</option>`).join('')}
    </select>
    <div class="chips">
      ${ranges.map(([v, l]) => `<button class="chip ${state.progressRange === v ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}
    </div>
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat"><div class="v">${cur ? Math.round(cur) : '—'}</div><div class="l">${L('1ПМ сейчас, кг', '1RM now, kg')}</div></div>
      <div class="stat"><div class="v">${best ? Math.round(best.best) : '—'}</div><div class="l">${L('Рекорд', 'Record')}${best ? ', ' + fmtDate(best.date, true).split(', ')[1] : ''}</div></div>
      <div class="stat"><div class="v">${tr ? pct(tr.change) : '—'}</div><div class="l">${L('За 5 недель', 'Over 5 weeks')}</div></div>
    </div>
    <div class="card">${chartSvg(ss)}</div>
    <div class="card tight">
      <h3>${L('Последние тренировки', 'Recent workouts')}</h3>
      <table class="list">
        <tr><th>${L('Дата', 'Date')}</th><th>${L('Подходы', 'Sets')}</th><th class="num">${L('1ПМ', '1RM')}</th></tr>
        ${all.slice(-8).reverse().map(s => `<tr><td>${fmtDate(s.date, false)}</td><td class="small">${esc(E.formatSets(s.sets))}</td><td class="num">${Math.round(s.best)}</td></tr>`).join('')}
      </table>
    </div>
  `;
}

function chartSvg(ss) {
  if (ss.length < 2) return `<div class="muted small">${L('Мало точек за этот период.', 'Not enough points for this period.')}</div>`;
  const W = 360, H = 200, Lp = 30, R = 8, T = 8, B = 20;
  const xs = ss.map(s => E.parseISO(s.date).getTime());
  const ys = ss.map(s => s.best);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max(2, (y1 - y0) * 0.1);
  y0 = Math.floor(y0 - pad); y1 = Math.ceil(y1 + pad);
  const X = x => Lp + ((x - x0) / (x1 - x0 || 1)) * (W - Lp - R);
  const Y = y => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  // скользящее среднее по 5 точкам — показывает тренд без шума
  const ma = ys.map((_, i) => { const a = ys.slice(Math.max(0, i - 4), i + 1); return a.reduce((p, c) => p + c, 0) / a.length; });
  const grid = [0, 0.5, 1].map(f => { const v = y0 + (y1 - y0) * f; return `<line x1="${Lp}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${Lp - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }).join('');
  const d0 = new Date(x0), d1 = new Date(x1);
  const lbl = d => `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('1ПМ по тренировкам', '1RM by workout')}">
      ${grid}
      ${ss.map((s, i) => `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="2.5" fill="var(--info)" opacity=".55"/>`).join('')}
      <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" points="${ma.map((v, i) => `${X(xs[i])},${Y(v)}`).join(' ')}"/>
      <text x="${Lp}" y="${H - 6}">${lbl(d0)}</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end">${lbl(d1)}</text>
    </svg>
    <div class="small muted">${L('Точки — 1ПМ по лучшему подходу тренировки, линия — среднее по 5 тренировкам.', 'Dots are the 1RM from each workout\'s best set, the line is the average over 5 workouts.')}</div>`;
}

// ---------- АНАЛИЗ ----------

const KEY_LIFTS = ['Bench Press · Barbell', 'Incline Bench Press · Barbell', 'Incline Bench Press · Dumbbell', 'Chest Dip',
  'Pull Up (Wide Grip)', 'Pull Up', 'Bent Over Row · Barbell', 'Overhead Press · Barbell', 'Curl · Barbell', 'Squat · Barbell'];

function renderAnalysis() {
  if (!state.workouts.length) {
    view.innerHTML = `<div class="empty muted">${L('Анализ появится после импорта истории.', 'Analysis will appear after you import your history.')}</div>`;
    return;
  }
  const t = today();
  const lastDate = state.workouts[state.workouts.length - 1].date;
  const anchor = E.daysBetween(lastDate, t) > 14 ? lastDate : t;
  const freq = E.frequencyStats(state.workouts, anchor);
  const vol = E.weeklySetsByMuscle(state.workouts, anchor, 4);
  const maxV = Math.max(22, ...Object.values(vol));
  const zr = E.repZoneResponse(state.workouts, KEY_LIFTS, t);
  const zoneNames = L({ strength: 'Сила (1–6)', hypertrophy: 'Масса (7–11)', volume: 'Объём (12+)' },
    { strength: 'Strength (1–6)', hypertrophy: 'Hypertrophy (7–11)', volume: 'Volume (12+)' });
  const zEntries = Object.entries(zr.zones).filter(([, z]) => z.n >= 5);
  const bestZone = zEntries.length ? zEntries.reduce((a, b) => (b[1].mean > a[1].mean ? b : a)) : null;

  const lifts = KEY_LIFTS.map(n => ({ n, e: E.currentE1rm(n, state.workouts, t), tr: E.trend(n, state.workouts, anchor, 56) })).filter(x => x.e);

  view.innerHTML = `
    <h2>${L('Анализ', 'Analysis')}</h2>
    ${anchor !== t ? `<p class="small muted">${L(`Последняя запись ${fmtDate(lastDate)}, поэтому считаю по 4 неделям до неё.`, `Last entry is ${fmtDate(lastDate)}, so I'm using the 4 weeks before it.`)}</p>` : ''}
    <div class="stat-grid" style="margin-bottom:12px">
      <div class="stat"><div class="v">${state.workouts.length}</div><div class="l">${L('тренировок всего', 'workouts total')}</div></div>
      <div class="stat"><div class="v">${freq.perWeek.toFixed(1)}</div><div class="l">${L('в неделю (12 нед.)', 'per week (12 wk)')}</div></div>
      <div class="stat"><div class="v">${freq.avgDuration ? Math.round(freq.avgDuration) : '—'}</div><div class="l">${L('мин в среднем', 'min on average')}</div></div>
    </div>

    <div class="card">
      <h3>${L('Рабочих подходов в неделю на мышцу', 'Working sets per muscle per week')}</h3>
      <p class="small muted">${L('Среднее за 4 недели. Зелёная зона — 10–20 подходов, это оптимум для массы.', 'Average over 4 weeks. The green zone is 10–20 sets, the sweet spot for muscle growth.')}</p>
      ${Object.entries(vol).map(([m, v]) => {
        const color = v < 10 ? 'var(--warn)' : v > 22 ? 'var(--bad)' : 'var(--accent)';
        return `<div class="hbar"><span>${E.MUSCLE_LABELS[m]}</span>
          <div class="track"><div class="zone" style="left:${10 / maxV * 100}%;width:${10 / maxV * 100}%"></div><i style="width:${Math.min(100, v / maxV * 100)}%;background:${color}"></i></div>
          <span class="num">${v.toFixed(1)}</span></div>`;
      }).join('')}
    </div>

    <div class="card">
      <h3>${L('Какие повторы давали тебе рост силы', 'Which rep ranges made you stronger')}</h3>
      <p class="small muted">${L('По всей истории основных упражнений: отрезки по 4 недели, где ты работал в основном в одном диапазоне, и как изменился 1ПМ за следующие 4 недели.', 'Across your whole history of main lifts: 4-week stretches where you trained mostly in one rep range, and how your 1RM changed over the next 4 weeks.')}</p>
      <table class="list">
        <tr><th>${L('Диапазон', 'Range')}</th><th class="num">${L('Отрезков', 'Stretches')}</th><th class="num">${L('Изменение 1ПМ', '1RM change')}</th></tr>
        ${Object.entries(zr.zones).map(([k, z]) => `<tr><td>${zoneNames[k]}</td><td class="num">${z.n}</td><td class="num">${z.mean == null ? '—' : pct(z.mean)}</td></tr>`).join('')}
      </table>
      <p class="small" style="margin-bottom:0">${zoneConclusion(zEntries, bestZone)}</p>
    </div>

    <div class="card">
      <h3>${L('Основные упражнения', 'Main lifts')}</h3>
      <table class="list">
        <tr><th>${L('Упражнение', 'Exercise')}</th><th class="num">${L('1ПМ', '1RM')}</th><th class="num">${L('8 нед.', '8 wk')}</th></tr>
        ${lifts.map(x => `<tr><td>${esc(x.n)}</td><td class="num">${Math.round(x.e)}</td><td class="num">${x.tr ? `<span class="badge ${x.tr.status}">${pct(x.tr.change)}</span>` : '—'}</td></tr>`).join('')}
      </table>
    </div>
  `;
}

function zoneConclusion(zEntries, bestZone) {
  if (!bestZone) return L('Пока мало данных для вывода.', 'Not enough data for a conclusion yet.');
  const allFlat = zEntries.every(([, z]) => Math.abs(z.mean) < 0.01);
  if (allFlat) {
    return L('Ни один диапазон сам по себе не давал роста: сила почти не менялась при любых повторах. Значит, дело не в повторах, а в отсутствии системы прогрессии. Именно это и исправляют блоки: каждая неделя со своей целью и вес, который растёт вслед за 1ПМ.',
      'No rep range on its own made you stronger: strength barely changed whatever the reps. So the problem isn\'t the reps, it\'s the lack of a progression system. That\'s exactly what the blocks fix: each week has its own goal, and the weight grows along with your 1RM.');
  }
  const names = L({ strength: 'малых', hypertrophy: 'средних', volume: 'больших' }, { strength: 'low', hypertrophy: 'moderate', volume: 'high' });
  return L(`Лучше всего тебе заходили отрезки с упором на ${names[bestZone[0]]} повторы (${pct(bestZone[1].mean)} за 4 недели). Это наблюдение, а не точный эксперимент: через 2–3 блока в приложении вывод станет надёжнее.`,
    `Stretches focused on ${names[bestZone[0]]} reps worked best for you (${pct(bestZone[1].mean)} over 4 weeks). This is an observation, not a controlled experiment: after 2–3 blocks in the app the conclusion will be more reliable.`);
}

// ---------- НАСТРОЙКИ ----------

function renderSettings() {
  const s = state.settings;
  const ph = E.phaseFor(today(), s);
  const days = Object.entries(state.templates).sort(([a], [b]) => ((+a + 6) % 7) - ((+b + 6) % 7));
  const freeDays = [1, 2, 3, 4, 5, 6, 0].filter(d => !state.templates[d]);
  view.innerHTML = `
    <h2>${L('Настройки', 'Settings')}</h2>
    <div class="card">
      <h3>Язык · Language</h3>
      <div class="row" style="gap:10px">
        <button class="grow ${LANG === 'ru' ? 'primary' : ''}" data-act="lang" data-lang="ru">Русский</button>
        <button class="grow ${LANG === 'en' ? 'primary' : ''}" data-act="lang" data-lang="en">English</button>
      </div>
    </div>

    <div class="card">
      <h3>${L('Периодизация', 'Periodization')}</h3>
      <p class="small muted">${L(`Блок из 4 недель: ${s.phaseOrder.map(k => E.PHASES[k].label).join(' → ')}. Сейчас: блок ${ph.blockNo}, неделя ${ph.weekInBlock}, «${ph.phase.label}».`,
        `4-week block: ${s.phaseOrder.map(k => E.PHASES[k].label).join(' → ')}. Now: block ${ph.blockNo}, week ${ph.weekInBlock}, "${ph.phase.label}".`)}</p>
      <label class="field"><span>${L('Начало блока (понедельник)', 'Block start (Monday)')}</span><input type="date" id="blockStart" value="${s.blockStart}"></label>
      <button class="block" data-act="block-now">${L('Начать новый блок с этой недели', 'Start a new block this week')}</button>
      <label class="field"><span>${L('Эта неделя', 'This week')}</span>
        <select id="phaseOverride">
          <option value="">${L('Авто', 'Auto')} (${E.PHASES[s.phaseOrder[ph.weekInBlock - 1]].label})</option>
          ${Object.entries(E.PHASES).map(([k, p]) => `<option value="${k}" ${s.phaseOverride?.week === ph.weekStart && s.phaseOverride.key === k ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>${L('Порядок недель в блоке', 'Order of weeks in a block')}</span>
        <select id="phaseOrder">
          ${[['volume', 'hypertrophy', 'strength', 'deload'], ['strength', 'volume', 'hypertrophy', 'deload'], ['hypertrophy', 'volume', 'strength', 'deload']]
            .map(o => `<option value="${o.join(',')}" ${o.join(',') === s.phaseOrder.join(',') ? 'selected' : ''}>${o.map(k => E.PHASES[k].label).join(' → ')}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>${L('Вес тела, кг (для подтягиваний и брусьев)', 'Bodyweight, kg (for pull-ups and dips)')}</span><input type="number" inputmode="decimal" step="0.1" id="bodyweight" value="${s.bodyweight}"></label>
    </div>

    <div class="card">
      <h3>${L('Дни и упражнения', 'Days and exercises')}</h3>
      ${days.map(([d, t]) => `
        <div style="margin:12px 0 4px" class="row between">
          <b>${E.WEEKDAYS[d]}</b>
          <input value="${esc(dayTitle(t.title))}" data-tpl-title="${d}" style="flex:1">
          <button class="small ghost danger" data-act="del-day" data-day="${d}" aria-label="${L('Удалить день', 'Delete day')}">✕</button>
        </div>
        ${t.exercises.map((n, i) => `
          <div class="tpl-item">${animThumb(n, 'mini')}<span>${esc(mediaFor(n)?.title || exName(n))}<small class="muted" style="display:block">${esc(exName(n))}</small></span>
            <button class="small ghost" data-act="tpl-up" data-day="${d}" data-i="${i}" aria-label="${L('Выше', 'Move up')}">↑</button>
            <button class="small ghost" data-act="tpl-del" data-day="${d}" data-i="${i}" aria-label="${L('Убрать', 'Remove')}">✕</button>
          </div>`).join('')}
        <button class="small" style="margin-top:6px" data-act="tpl-add" data-day="${d}">＋ ${L('Добавить упражнение', 'Add exercise')}</button>`).join('')}
      ${freeDays.length ? `
        <div class="row" style="margin-top:14px">
          <select id="newDay">${freeDays.map(d => `<option value="${d}">${E.WEEKDAYS[d]}</option>`).join('')}</select>
          <button class="small" data-act="add-day">${L('Добавить день', 'Add day')}</button>
        </div>` : ''}
      <button class="small ghost" style="margin-top:10px" data-act="reset-tpl">${L('Вернуть программу по умолчанию', 'Restore the default program')}</button>
    </div>

    <div class="card">
      <h3>${L('Часы и уведомления', 'Watch and notifications')}</h3>
      <p class="small muted">${L('Когда отдых заканчивается, GymCoach присылает уведомление. Zepp пересылает его на часы Amazfit, и они вибрируют, так что кнопку таймера на часах нажимать не нужно.',
        'When rest ends, GymCoach sends a notification. Zepp forwards it to your Amazfit watch and it vibrates, so you don\'t need to press a timer on the watch.')}</p>
      <label class="switch"><input type="checkbox" id="watchNotify" ${s.watchNotify && typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'checked' : ''}><span>${L('Сигнал «Отдых закончен» на часы', '"Rest is over" alert on the watch')}</span></label>
      <label class="switch"><input type="checkbox" id="watchNotifyStart" ${s.watchNotifyStart ? 'checked' : ''}><span>${L('Ещё и в начале отдыха: «Отдых до 15:08:30» (часы вибрируют дважды)', 'Also at the start of rest: "Rest until 15:08:30" (the watch vibrates twice)')}</span></label>
      <button class="block" data-act="test-notify" style="margin-top:8px">${L('Проверить на часах (сигнал через 5 секунд)', 'Test on the watch (alert in 5 seconds)')}</button>
      <details class="small muted" style="margin-top:10px"><summary>${L('Если на часы не приходит', 'If nothing arrives on the watch')}</summary>
        <ol class="steps">${L(`
          <li>Zepp → Профиль → Amazfit GTS 4 mini → Уведомления: включи и отметь в списке приложений <b>Chrome</b>. Иногда GymCoach показан отдельной строкой — тогда отметь её.</li>
          <li>Android: Настройки → Приложения → GymCoach (или Chrome) → Уведомления → разрешить.</li>
          <li>На часах выключи «Не беспокоить». В Zepp проверь, что пересылка работает и при включённом экране телефона: опция вроде «Уведомлять, даже когда телефон разблокирован».</li>
          <li>Во время тренировки не блокируй телефон кнопкой: приложение само не даёт экрану погаснуть. Если заблокировать, сигнал может прийти с опозданием.</li>`, `
          <li>Zepp → Profile → Amazfit GTS 4 mini → Notifications: turn them on and tick <b>Chrome</b> in the app list. Sometimes GymCoach is listed separately — then tick that.</li>
          <li>Android: Settings → Apps → GymCoach (or Chrome) → Notifications → allow.</li>
          <li>Turn off "Do not disturb" on the watch. In Zepp, check that forwarding also works while the phone screen is on: an option like "Notify even when the phone is unlocked".</li>
          <li>If the alert comes late with the phone locked, keep the screen on during the workout: the app stops it from turning off by itself.</li>`)}
        </ol>
      </details>
    </div>

    <div class="card">
      <h3>${L('Данные', 'Data')}</h3>
      <p class="small muted">${L('Всё хранится только на этом телефоне. Отправляй копию в Telegram «Избранное» или на Google Диск раз в неделю: тогда данные не пропадут даже при потере телефона.',
        'Everything is stored only on this phone. Send a backup to Telegram "Saved Messages" or Google Drive once a week: then your data is safe even if you lose the phone.')}</p>
      <p class="small" style="margin:0 0 10px">${backupStatusText()}</p>
      <div class="row" style="flex-direction:column;align-items:stretch">
        <button class="primary" data-act="share-backup">${L('Поделиться копией (Telegram, Google Диск…)', 'Share backup (Telegram, Google Drive…)')}</button>
        <button data-act="export-json">${L('Скачать копию в «Загрузки»', 'Download backup to Downloads')}</button>
        <button data-act="import-txt">${L('Импортировать TXT из GymKeeper', 'Import TXT from GymKeeper')}</button>
        <button data-act="import-json">${L('Восстановить из резервной копии', 'Restore from backup')}</button>
        <button class="danger" data-act="wipe">${L('Удалить все данные', 'Delete all data')}</button>
      </div>
    </div>
    <p class="small muted">${L('ИИ-советы (Claude) подключим следующим шагом: сейчас все расчёты делает код прямо в телефоне, без интернета.',
      'AI tips (Claude) will come next: for now all calculations run right on the phone, without internet.')}</p>
  `;
}

// ---------- импорт и экспорт ----------

function importTxt(text) {
  const { workouts } = parseGymKeeperTxt(text);
  if (!workouts.length) { toast(L('В файле не нашлось тренировок', 'No workouts found in the file')); return; }
  // импортированные заменяем целиком, свои тренировки из приложения не трогаем
  const own = state.workouts.filter(w => w.source !== 'import');
  state.workouts = [...workouts, ...own];
  persistWorkouts();
  toast(L(`Импортировано ${workouts.length} тренировок`, `Imported ${workouts.length} workouts`));
  render();
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const LAST_BACKUP_KEY = 'gc.lastBackup';

function backupText() {
  let media = {};
  try { media = JSON.parse(localStorage.getItem('gc.media') || '{}'); } catch { /* пусто */ }
  return JSON.stringify({
    app: 'gymcoach', version: 1, exportedAt: new Date().toISOString(),
    workouts: state.workouts, settings: state.settings, templates: state.templates, media, custom: load(CUSTOM_KEY, {}),
  });
}
function backupName() { return `gymcoach-backup-${today()}.txt`; }

function markBackup() {
  save(LAST_BACKUP_KEY, new Date().toISOString());
}
function lastBackup() { return load(LAST_BACKUP_KEY, null); }
function backupAgeDays() {
  const b = lastBackup();
  return b ? Math.floor((Date.now() - new Date(b).getTime()) / 86400000) : null;
}

function exportJson() {
  download(backupName(), backupText());
  markBackup();
  toast(L('Копия сохранена в «Загрузки»', 'Backup saved to Downloads'));
}

// Меню Android «Поделиться»: копия уходит в Telegram «Избранное», Google Диск и т.п.
// Файл .txt — Chrome на Android разрешает делиться текстовыми файлами, а .json — не везде.
async function shareBackup() {
  const file = new File([backupText()], backupName(), { type: 'text/plain' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: L('GymCoach — резервная копия', 'GymCoach — backup'), text: L(`Резервная копия GymCoach от ${fmtDate(today())}`, `GymCoach backup from ${fmtDate(today())}`) });
      markBackup();
      toast(L('Копия отправлена', 'Backup sent'));
      render();
    } catch (e) {
      if (e.name !== 'AbortError') toast(L('Не получилось поделиться: ', 'Could not share: ') + e.message);
    }
  } else {
    exportJson();
    render();
  }
}

function importJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { toast(L('Это не файл резервной копии', 'This is not a backup file')); return; }
  if (data.app !== 'gymcoach' || !Array.isArray(data.workouts)) { toast(L('Это не файл резервной копии GymCoach', 'This is not a GymCoach backup file')); return; }
  const bDate = String(data.exportedAt).slice(0, 10);
  if (!confirm(L(`Заменить текущие данные копией от ${bDate} (${data.workouts.length} тренировок)?`, `Replace current data with the backup from ${bDate} (${data.workouts.length} workouts)?`))) return;
  state.workouts = data.workouts;
  state.settings = { ...E.DEFAULT_SETTINGS, ...data.settings };
  state.templates = data.templates || E.DEFAULT_TEMPLATES;
  persistWorkouts();
  save(KEYS.settings, state.settings);
  save(KEYS.templates, state.templates);
  if (data.media) save('gc.media', data.media);
  if (data.custom) save(CUSTOM_KEY, data.custom);
  markBackup();
  toast(L('Восстановлено', 'Restored'));
  setTimeout(() => location.reload(), 800);
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

view.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const { act } = b.dataset;
  const i = b.dataset.i != null ? +b.dataset.i : null;
  const day = b.dataset.day;

  if (b.dataset.range != null) { state.progressRange = +b.dataset.range; renderProgress(); return; }
  if (b.classList.contains('chip') && day != null) { state.pickDay = +day; renderToday(); return; }

  switch (act) {
    case 'media': openMedia(b.dataset.name); break;
    case 'pick-media': openPicker(b.dataset.name); break;
    case 'start': startSession(+day); break;
    case 'toggle-set': toggleSet(i, +b.dataset.j); break;
    case 'add-set': {
      const it = state.draft.items[i];
      const last = it.sets[it.sets.length - 1];
      it.sets.push({ w: last?.w ?? it.plan.weight, r: last?.r ?? it.plan.targetReps, rir: it.plan.rir, done: false, edited: false });
      save(KEYS.draft, state.draft); renderSession(); break;
    }
    case 'del-set': state.draft.items[i].sets.pop(); save(KEYS.draft, state.draft); renderSession(); break;
    case 'add-drop': {
      // дроп: снял блин и продолжил без отдыха. Свой вес — минус 5 кг отягощения, остальное — примерно −25%.
      const it = state.draft.items[i];
      const base = it.sets[it.sets.length - 1];
      const bw = state.settings.bodyweight;
      const w0 = +base?.w || it.plan.weight || 0;
      const w = it.plan.meta.equip === 'bodyweight' ? Math.max(bw, w0 - 5) : E.roundWeight(w0 * 0.75, it.plan.meta, state.settings);
      it.sets.push({ w, r: Math.max(1, Math.round((+base?.r || it.plan.targetReps) * 0.6)), rir: 0, done: false, edited: true, drop: true });
      save(KEYS.draft, state.draft); renderSession(); break;
    }
    case 'ses-link': {
      const it = state.draft.items[i];
      it.link = !it.link; save(KEYS.draft, state.draft); renderSession();
      toast(it.link ? L('Связано в суперсет', 'Linked as a superset') : L('Суперсет разорван', 'Superset unlinked'));
      break;
    }
    case 'tpl-link': {
      const t = state.templates[day];
      t.linked = t.linked || [];
      t.linked[i] = !t.linked[i]; saveTemplates(); render();
      break;
    }
    case 'remove-ex':
      if (state.draft.items[i].sets.some(s => s.done) && !confirm(L('В упражнении есть выполненные подходы. Убрать?', 'This exercise has completed sets. Remove it?'))) return;
      state.draft.items.splice(i, 1);
      if (state.draft.items.length) state.draft.items[state.draft.items.length - 1].link = false;
      save(KEYS.draft, state.draft); renderSession(); break;
    case 'open-add':
      openExercisePicker(L('Добавить в тренировку', 'Add to workout'), name => {
        const p = { ...E.prescribe(name, state.draft.phaseKey, state.workouts, state.settings, today()), trend: E.trend(name, state.workouts, today()) };
        state.draft.items.push(makeItem(p));
        save(KEYS.draft, state.draft);
        renderSession();
        toast(L('Добавлено: ', 'Added: ') + (mediaFor(name)?.title || exName(name)));
        requestAnimationFrame(() => view.querySelectorAll('.card.tight')[state.draft.items.length]?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      });
      break;
    case 'cancel':
      if (confirm(L('Отменить тренировку? Отмеченные подходы не сохранятся.', 'Cancel the workout? Checked sets won\'t be saved.'))) {
        state.draft = null; save(KEYS.draft, null); stopTimer(); releaseWakeLock(); render();
      }
      break;
    case 'finish': finishSession(); break;
    case 'more-history': state.historyLimit += 30; renderHistory(); break;
    case 'del-workout':
      if (confirm(L('Удалить эту тренировку из истории?', 'Delete this workout from history?'))) {
        state.workouts = state.workouts.filter(w => w.id !== b.dataset.id); persistWorkouts(); renderHistory();
      }
      break;
    case 'import-txt': fileTxt.click(); break;
    case 'import-json': fileJson.click(); break;
    case 'export-json': exportJson(); renderSettings(); break;
    case 'share-backup': shareBackup(); break;
    case 'test-notify': {
      if (!(await enableWatchNotify())) return;
      state.settings.watchNotify = true; saveSettings();
      const cb = document.getElementById('watchNotify'); if (cb) cb.checked = true;
      toast(L('Жди сигнал на часах через 5 секунд', 'Wait for the alert on your watch in 5 seconds'));
      setTimeout(() => showNote(L('GymCoach: проверка часов', 'GymCoach: watch test'), L('Если часы завибрировали — всё работает 💪', 'If your watch vibrated, everything works 💪')).then(ok => { if (!ok) toast(L('Не получилось показать уведомление', 'Could not show the notification')); }), 5000);
      break;
    }
    case 'lang': if (b.dataset.lang !== LANG) setLang(b.dataset.lang); break;
    case 'backup-later':
      save('gc.backupSnooze', today()); renderToday(); break;
    case 'wipe':
      if (confirm(L('Удалить ВСЕ тренировки и настройки с этого телефона? Это нельзя отменить.', 'Delete ALL workouts and settings from this phone? This can\'t be undone.'))) {
        Object.values(KEYS).forEach(k => save(k, null)); location.reload();
      }
      break;
    case 'block-now':
      state.settings.blockStart = E.mondayOf(today()); state.settings.phaseOverride = null; saveSettings(); renderSettings();
      toast(L('Новый блок начат с этой недели', 'A new block starts this week')); break;
    // правка программы дня — и в настройках, и на экране «Сегодня» до старта тренировки
    case 'tpl-del': {
      const [gone] = state.templates[day].exercises.splice(i, 1);
      state.templates[day].linked?.splice(i, 1);
      saveTemplates(); render();
      toast(L('Убрано: ', 'Removed: ') + (mediaFor(gone)?.title || exName(gone)));
      break;
    }
    case 'tpl-up': {
      if (i === 0) return;
      const ex = state.templates[day].exercises;
      [ex[i - 1], ex[i]] = [ex[i], ex[i - 1]];
      const ln = state.templates[day].linked;
      if (ln) { ln[i - 1] = false; ln[i] = false; if (i > 1) ln[i - 2] = false; }
      saveTemplates(); render(); break;
    }
    case 'tpl-add':
      openExercisePicker(`${L('Добавить в', 'Add to')} ${E.WEEKDAYS[day]} · ${dayTitle(state.templates[day].title)}`, name => {
        state.templates[day].exercises.push(name); saveTemplates(); render();
        toast(L('Добавлено в программу', 'Added to the program'));
      });
      break;
    case 'del-day':
      if (confirm(L(`Удалить день ${E.WEEKDAYS[day]} из программы?`, `Remove ${E.WEEKDAYS[day]} from the program?`))) { delete state.templates[day]; saveTemplates(); renderSettings(); }
      break;
    case 'add-day': {
      const d = document.getElementById('newDay').value;
      state.templates[d] = { title: 'Новая тренировка', exercises: [] }; saveTemplates(); renderSettings(); break;
    }
    case 'reset-tpl':
      if (confirm(L('Вернуть программу по умолчанию? Твои правки дней пропадут.', 'Restore the default program? Your changes to the days will be lost.'))) {
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

view.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'progressEx') { state.progressEx = el.value; renderProgress(); }
  if (el.id === 'watchNotify') {
    if (el.checked && !(await enableWatchNotify())) { el.checked = false; return; }
    state.settings.watchNotify = el.checked; saveSettings();
    toast(el.checked ? L('Сигнал на часы включён', 'Watch alert on') : L('Сигнал на часы выключен', 'Watch alert off'));
  }
  if (el.id === 'watchNotifyStart') { state.settings.watchNotifyStart = el.checked; saveSettings(); }
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
  if (v === 'stop') { stopTimer(); closeRestNote(); }
  else {
    timer.end += +v * 1000;
    timer.total = Math.max(timer.total, (timer.end - Date.now()) / 1000);
    if (notifyEnabled() && state.settings.watchNotifyStart && !timer.buzzed) {
      showNote(L(`Отдых — до ${clockText(timer.end)}`, `Rest — until ${clockText(timer.end)}`), `${L('Дальше', 'Next')}: ${timer.nextUp}`, { silent: true });
    }
    tickTimer();
  }
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

// ---------- окно техники и выбор картинки ----------

const modal = document.createElement('div');
modal.className = 'modal hidden';
document.body.appendChild(modal);

function closeModal() {
  modal.classList.add('hidden');
  modal.innerHTML = '';
  document.body.classList.remove('modal-open');
}
function showModal(html) {
  modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

async function openMedia(name) {
  const m = mediaFor(name);
  if (!m) return openPicker(name);
  if (m.custom) {
    showModal(`
      <div class="row between"><h3 style="margin:0">${esc(m.title)}</h3><button class="ghost small" data-m="close" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
      <div class="small muted" style="margin-bottom:8px">${esc(name)} · ${L('твоё упражнение', 'your exercise')}</div>
      <img src="${esc(m.frames[0])}" alt="" style="width:100%;border-radius:12px;display:block">
      <label class="block photo-btn" style="margin-top:10px">📷 ${L('Переснять фото', 'Retake photo')}<input type="file" accept="image/*" capture="environment" id="cfRetake" hidden></label>`);
    document.getElementById('cfRetake').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        saveCustom(name, { ...customInfo(name), photo: await shrinkPhoto(f) });
        closeModal(); render(); toast(L('Фото обновлено', 'Photo updated'));
      } catch { toast(L('Не получилось сохранить фото: память телефона заполнена', 'Could not save the photo: storage is full')); }
    });
    return;
  }
  showModal(`
    <div class="row between"><h3 style="margin:0">${esc(m.title)}</h3><button class="ghost small" data-m="close" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
    <div class="small muted" style="margin-bottom:8px">${esc(exName(name))}</div>
    <div class="anim big"><img src="${esc(m.frames[0])}" alt=""><img class="f2" src="${esc(m.frames[1])}" alt=""></div>
    <ol class="steps" id="mSteps"><li class="muted">${L('Загружаю технику…', 'Loading technique…')}</li></ol>
    <div class="row" style="margin-top:10px">
      <button class="small" data-m="pick" data-name="${esc(name)}">${L('Сменить картинку', 'Change picture')}</button>
    </div>
    <p class="small muted" style="margin-bottom:0">${L('Картинки и описание: free-exercise-db, общественное достояние.', 'Pictures and instructions: free-exercise-db, public domain.')}</p>`);
  const { steps, lang } = await stepsFor(m.id);
  const el = document.getElementById('mSteps');
  if (!el) return;
  el.innerHTML = steps.length
    ? steps.map(s => `<li>${esc(s)}</li>`).join('') + (lang === 'en' && LANG !== 'en' ? '<li class="muted small" style="list-style:none">Перевода пока нет, показываю оригинал.</li>' : '')
    : `<li class="muted" style="list-style:none">${L('Описание недоступно без интернета.', 'Instructions are not available offline.')}</li>`;
}

// ---------- выбор упражнения с картинками ----------

const MUSCLE_FILTERS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'legs', 'abs'];
const DB_MUSCLE = {
  chest: 'chest', lats: 'back', 'middle back': 'back', 'lower back': 'back', traps: 'back',
  shoulders: 'shoulders', biceps: 'biceps', triceps: 'triceps', forearms: 'forearms',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
  abdominals: 'abs',
};
const addPicker = { cb: null, muscle: '', q: '', photo: null };

// Все упражнения приложения: из истории, программы, встроенные в приложение и свои с фото.
// Одинаковые картинки (например, «Pull Up» и «Pull Up (Wide Grip)») показываем один раз — тот, что делал чаще.
function exerciseCandidates() {
  const count = {};
  for (const w of state.workouts) for (const ex of w.exercises) count[ex.name] = (count[ex.name] || 0) + 1;
  for (const t of Object.values(state.templates)) for (const n of t.exercises) count[n] = count[n] || 0;
  for (const n of bundledNames()) count[n] = count[n] || 0;
  for (const n of customNames()) count[n] = count[n] || 0;
  const best = new Map();
  for (const [name, c] of Object.entries(count)) {
    const media = mediaFor(name);
    if (!media && c < 3) continue;
    const meta = E.exerciseMeta(name);
    const key = media?.id ? `${media.id}|${meta.kind}` : name;
    const cur = best.get(key);
    if (!cur || c > cur.count) best.set(key, { name, count: c, media, muscle: meta.muscle });
  }
  return [...best.values()].sort((a, b) => b.count - a.count
    || (a.media?.title || a.name).localeCompare(b.media?.title || b.name, LANG));
}

function openExercisePicker(title, cb) {
  addPicker.cb = cb;
  addPicker.muscle = '';
  addPicker.q = '';
  showModal(`
    <div class="row between"><h3 style="margin:0">${esc(title)}</h3><button class="ghost small" data-m="close" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
    <input id="pkSearch" type="search" placeholder="${L('Поиск: бицепс гантели, жим, махи…', 'Search: bench, row, curl, raise…')}" style="width:100%;margin:10px 0 8px" autocomplete="off">
    <div class="chips" id="pkChips">
      <button class="chip on" data-m="flt" data-mu="">${L('Все', 'All')}</button>
      ${MUSCLE_FILTERS.map(m => `<button class="chip" data-m="flt" data-mu="${m}">${E.MUSCLE_LABELS[m]}</button>`).join('')}
    </div>
    <div id="pkList"></div>`);
  document.getElementById('pkSearch').addEventListener('input', e => { addPicker.q = e.target.value; renderPickerList(); });
  renderPickerList();
}

function pickRow(attrs, thumb, titleText, sub) {
  return `<button class="result pick" ${attrs}>${thumb}<span><b>${esc(titleText)}</b><small class="muted">${esc(sub)}</small></span></button>`;
}

let pickerSeq = 0;
async function renderPickerList() {
  const seq = ++pickerSeq;
  const q = addPicker.q.trim();
  const words = norm(q).split(/\s+/).filter(w => w.length > 1).map(stem);
  const mine = exerciseCandidates().filter(x =>
    (!addPicker.muscle || x.muscle === addPicker.muscle) &&
    (!words.length || words.every(w => norm(`${x.name} ${x.media?.title || ''} ${x.media?.en || ''} ${E.MUSCLE_LABELS[x.muscle]}`).includes(w))));

  let html = '';
  if (mine.length) {
    html += `<div class="pk-head">${L('Упражнения в приложении', 'Exercises in the app')}</div>` + mine.map(x => {
      const title = x.media?.title || exName(x.name);
      const thumb = x.media
        ? `<span class="anim mini"><img src="${esc(x.media.frames[0])}" alt="" loading="lazy"><img class="f2" src="${esc(x.media.frames[1])}" alt="" loading="lazy"></span>`
        : '<span class="anim mini empty-anim">?</span>';
      const sub = `${E.MUSCLE_LABELS[x.muscle]}${x.count ? ` · ${L(`делал ${x.count} раз`, `done ${x.count} times`)}` : ''}`;
      return pickRow(`data-m="add-pick" data-name="${esc(x.name)}"`, thumb, title, sub);
    }).join('');
  }

  if (words.length) {
    let more;
    try { more = await searchDb(q); } catch { more = null; }
    if (seq !== pickerSeq) return;
    if (more) {
      const have = new Set(mine.map(x => x.media?.id).filter(Boolean));
      more = more.filter(r => !r.bundled && !have.has(r.id) && (!addPicker.muscle || DB_MUSCLE[r.muscle] === addPicker.muscle)).slice(0, 25);
      if (more.length) {
        html += `<div class="pk-head">${L('Ещё из большой базы (картинка с интернетом)', 'More from the big database (picture needs internet)')}</div>` + more.map(r => pickRow(
          `data-m="add-db" data-id="${esc(r.id)}" data-dbname="${esc(r.name)}"`,
          `<span class="anim mini"><img src="${esc(r.thumb)}" alt="" loading="lazy"></span>`,
          LANG === 'en' ? r.name : (r.ru || r.name), `${E.MUSCLE_LABELS[DB_MUSCLE[r.muscle] || 'other']}${LANG === 'en' ? '' : ' · ' + r.name}`,
        )).join('');
      }
    } else {
      html += `<p class="muted small">${L('Большая база доступна только с интернетом.', 'The big database needs internet.')}</p>`;
    }
  }
  html += `<button class="block photo-btn" data-m="custom-form" style="margin-top:10px">📷 ${q
    ? L(`Своё упражнение «${esc(q)}» с фото`, `Custom exercise "${esc(q)}" with a photo`)
    : L('Своё упражнение: сфотографировать тренажёр', 'Custom exercise: take a photo of the machine')}</button>`;
  if (seq !== pickerSeq) return;
  const box = document.getElementById('pkList');
  if (box) box.innerHTML = (mine.length || words.length ? '' : `<p class="muted small">${L('Ничего не нашлось. Попробуй другое слово.', 'Nothing found. Try another word.')}</p>`) + html;
}

function finishPick(name) {
  const cb = addPicker.cb;
  closeModal();
  cb?.(name);
}

// ---------- своё упражнение с фото тренажёра ----------

const EQUIP_SUFFIX = { machine: ' · Machine', cable: ' · Cable', dumbbell: ' · Dumbbell', barbell: ' · Barbell', bodyweight: '' };

function openCustomForm(prefill = '') {
  addPicker.photo = null;
  const mu = addPicker.muscle || 'biceps';
  showModal(`
    <div class="row between"><h3 style="margin:0">${L('Своё упражнение', 'Custom exercise')}</h3><button class="ghost small" data-m="close" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
    <label class="field"><span>${L('Название', 'Name')}</span><input id="cfName" value="${esc(prefill)}" placeholder="${L('Например: бицепс в тренажёре', 'For example: biceps machine')}" autocomplete="off"></label>
    <label class="field"><span>${L('Какие мышцы', 'Muscles')}</span><select id="cfMuscle">${MUSCLE_FILTERS.map(m => `<option value="${m}" ${m === mu ? 'selected' : ''}>${E.MUSCLE_LABELS[m]}</option>`).join('')}</select></label>
    <label class="field"><span>${L('Чем делается', 'Equipment')}</span><select id="cfEquip">
      <option value="machine">${L('Тренажёр', 'Machine')}</option>
      <option value="cable">${L('Блок (трос)', 'Cable')}</option>
      <option value="dumbbell">${L('Гантели', 'Dumbbells')}</option>
      <option value="barbell">${L('Штанга', 'Barbell')}</option>
      <option value="bodyweight">${L('Свой вес', 'Bodyweight')}</option>
    </select></label>
    <label class="switch"><input type="checkbox" id="cfCompound"><span>${L('Многосуставное: жим, тяга, приседание (веса будут как в базовых)', 'Compound: press, row, squat (weights like main lifts)')}</span></label>
    <label class="block photo-btn" style="margin-top:10px">📷 ${L('Сфотографировать тренажёр', 'Take a photo of the machine')}<input type="file" accept="image/*" capture="environment" id="cfPhoto" hidden></label>
    <img id="cfPreview" alt="" style="width:100%;border-radius:12px;margin-top:8px;display:none">
    <p class="small muted" id="cfErr" style="color:var(--bad);display:none"></p>
    <button class="primary block" data-m="cf-save" style="margin-top:10px">${L('Сохранить и добавить', 'Save and add')}</button>`);
  document.getElementById('cfPhoto').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      addPicker.photo = await shrinkPhoto(f);
      const im = document.getElementById('cfPreview');
      im.src = addPicker.photo; im.style.display = 'block';
    } catch { toast(L('Не получилось открыть фото', 'Could not open the photo')); }
  });
  document.getElementById('cfName').focus();
}

function saveCustomForm() {
  const raw = document.getElementById('cfName').value.trim().replace(/\s*·\s*/g, ' ');
  const err = document.getElementById('cfErr');
  if (!raw) { err.textContent = L('Напиши название упражнения', 'Enter the exercise name'); err.style.display = 'block'; return; }
  const equip = document.getElementById('cfEquip').value;
  const name = raw + EQUIP_SUFFIX[equip];
  const info = {
    photo: addPicker.photo || customInfo(name)?.photo || null,
    muscle: document.getElementById('cfMuscle').value,
    equip,
    kind: document.getElementById('cfCompound').checked ? 'compound' : 'isolation',
  };
  try { saveCustom(name, info); } catch {
    err.textContent = L('Память телефона заполнена: фото не сохранилось. Попробуй без фото.', 'Storage is full: the photo was not saved. Try without a photo.');
    err.style.display = 'block'; return;
  }
  E.registerExercise(name, info);
  toast(L('Упражнение сохранено', 'Exercise saved'));
  finishPick(name);
}

let pickerFor = null;
async function openPicker(name) {
  pickerFor = name;
  const words = name.toLowerCase().replace(/[·()]/g, ' ').replace(/\b(barbell|machine|cable|grip|single|arm)\b/g, ' ').replace(/\s+/g, ' ').trim();
  showModal(`
    <div class="row between"><h3 style="margin:0">${L('Картинка для упражнения', 'Exercise picture')}</h3><button class="ghost small" data-m="close" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
    <div class="small muted" style="margin:4px 0 8px">${esc(exName(name))}</div>
    <input id="mSearch" type="search" placeholder="${L('Поиск: бицепс гантели, жим, bench…', 'Search: bench, curl, row…')}" value="${esc(words)}" style="width:100%">
    <div id="mResults" class="results"></div>
    ${mediaFor(name) ? `<button class="small ghost danger" data-m="unpick" style="margin-top:8px">${L('Убрать свою картинку', 'Remove my picture')}</button>` : ''}`);
  const inp = document.getElementById('mSearch');
  inp.addEventListener('input', () => runSearch(inp.value));
  runSearch(inp.value);
}

let searchSeq = 0;
async function runSearch(q) {
  const seq = ++searchSeq;
  let res;
  try { res = await searchDb(q); } catch { res = null; }
  if (seq !== searchSeq) return;
  const box = document.getElementById('mResults');
  if (!box) return;
  if (!res) { box.innerHTML = `<p class="muted small">${L('Поиск не загрузился. Нужен интернет.', 'Search didn\'t load. Internet is needed.')}</p>`; return; }
  box.innerHTML = res.length
    ? res.map(r => `<button class="result" data-m="choose" data-id="${esc(r.id)}"><img src="${esc(r.thumb)}" alt="" loading="lazy"><span><b>${esc(LANG === 'en' ? r.name : (r.ru || r.name))}</b><small class="muted">${esc(LANG === 'en' ? r.muscle : r.name)} · ${esc(r.equip)}</small></span></button>`).join('')
    : `<p class="muted small">${L('Ничего не нашлось. Попробуй другое слово.', 'Nothing found. Try another word.')}</p>`;
}

modal.addEventListener('click', e => {
  if (e.target === modal) return closeModal();
  const b = e.target.closest('[data-m]');
  if (!b) return;
  const a = b.dataset.m;
  if (a === 'close') closeModal();
  if (a === 'flt') {
    addPicker.muscle = b.dataset.mu;
    modal.querySelectorAll('#pkChips .chip').forEach(c => c.classList.toggle('on', c === b));
    renderPickerList();
  }
  if (a === 'add-pick') finishPick(b.dataset.name);
  if (a === 'add-db') {
    // встроенное упражнение — под своим именем из дневника, остальные — под названием базы с её картинкой
    const name = appNameFor(b.dataset.id) || b.dataset.dbname;
    if (!appNameFor(b.dataset.id)) setPick(name, b.dataset.id);
    finishPick(name);
  }
  if (a === 'custom-form') openCustomForm(addPicker.q.trim());
  if (a === 'cf-save') saveCustomForm();
  if (a === 'pick') openPicker(b.dataset.name);
  if (a === 'choose' || a === 'unpick') {
    setPick(pickerFor, a === 'choose' ? b.dataset.id : null);
    closeModal();
    render();
    toast(a === 'choose' ? L('Картинка сохранена', 'Picture saved') : L('Картинка убрана', 'Picture removed'));
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// подписи вкладок и таймера из index.html
if (LANG === 'en') {
  document.documentElement.lang = 'en';
  const TABS = { today: 'Today', history: 'History', progress: 'Progress', analysis: 'Analysis', settings: 'Settings' };
  document.querySelectorAll('#tabs button').forEach(b => { const t = b.lastChild; if (t?.nodeType === 3) t.textContent = TABS[b.dataset.tab]; });
  const rl = document.querySelector('#timer .small.muted'); if (rl) rl.textContent = 'Rest';
  const st = document.querySelector('[data-timer="stop"]'); if (st) st.textContent = 'Stop';
}

await initMedia();
for (const n of customNames()) E.registerExercise(n, customInfo(n));
render();
if (state.draft) requestWakeLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
