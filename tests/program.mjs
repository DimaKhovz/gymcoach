import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseGymKeeperTxt } from '../js/parser.js';
import * as E from '../js/engine.js';

const { workouts } = parseGymKeeperTxt(fs.readFileSync(process.argv[2], 'utf8'));
const today = '2026-11-14';
// как после миграции: блок с 16.11, эта неделя — «Масса»
const s = { ...E.DEFAULT_SETTINGS, blockStart: '2026-11-16', phaseOverride: { week: '2026-11-09', key: 'hypertrophy' } };
const ph = E.phaseFor(today, s);
assert.equal(ph.key, 'hypertrophy');
assert.equal(ph.blockNo, 0);
assert.equal(E.phaseFor('2026-11-17', s).key, 'volume');
assert.equal(E.phaseFor('2026-11-17', s).blockNo, 1);

for (const day of [6, 0, 2, 4]) {
  const t = E.DEFAULT_TEMPLATES[day];
  console.log(`\n== ${E.WEEKDAYS[day]} ${t.title}`);
  for (const key of ['hypertrophy', 'volume', 'strength']) {
    console.log(' ', key.padEnd(11), t.exercises.map(n => {
      const p = E.prescribe(n, key, workouts, s, today);
      const w = p.weight == null ? '?' : (p.meta.equip === 'bodyweight' ? (p.weight > 72 ? '+' + (p.weight - 72) : 'BW') : p.weight);
      return `${n.split(' · ')[0].replace('Lateral Raise (техника)', 'LR-tech').slice(0, 14)} ${p.sets}×${p.reps[0]}-${p.reps[1]}@${w}`;
    }).join(' | '));
  }
}
const plans = E.DEFAULT_TEMPLATES[6].exercises.map(n => ({ ...E.prescribe(n, ph.key, workouts, s, today), trend: E.trend(n, workouts, today) }));
console.log('\n' + E.adviceForToday({ plans, phaseInfo: ph, workouts, today, settings: s }).join('\n'));
const muscles = E.weeklySetsByMuscle(workouts, '2026-10-15', 4);
assert.ok('forearms' in muscles);
console.log('PROGRAM OK');
