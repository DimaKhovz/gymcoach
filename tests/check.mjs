import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseGymKeeperTxt, parseSetLine, normalizeName } from '../js/parser.js';
import * as E from '../js/engine.js';

// юнит-проверки
assert.deepEqual(parseSetLine('\t 112kg*4, drop (+40)'), { w: 112, r: 4, flag: 'drop', note: '+40' });
assert.deepEqual(parseSetLine('\t 16kg*20, warmup'), { w: 16, r: 20, flag: 'warmup' });
assert.deepEqual(parseSetLine('\t 6min:1km'), { raw: '6min:1km' });
assert.equal(normalizeName('pull to face '), 'Face Pull · Cable');
assert.equal(normalizeName('biceps 💪'), 'biceps');
assert.equal(E.mondayOf('2026-11-15'), '2026-11-09');
assert.equal(E.roundWeight(31.1, E.exerciseMeta('Incline Bench Press · Dumbbell'), E.DEFAULT_SETTINGS), 32);
assert.equal(E.roundWeight(60, E.exerciseMeta('Chest Dip'), E.DEFAULT_SETTINGS), 72);
const s = { ...E.DEFAULT_SETTINGS, blockStart: '2026-11-09' };
assert.equal(E.phaseFor('2026-11-15', s).key, 'volume');
assert.equal(E.phaseFor('2026-11-17', s).key, 'hypertrophy');
assert.equal(E.phaseFor('2026-12-01', s).key, 'deload');
assert.equal(E.phaseFor('2026-12-07', s).blockNo, 2);
assert.equal(E.phaseFor('2026-11-01', s).key, 'strength'); // за 2 недели до старта — по кругу назад

// реальный дневник
const txt = fs.readFileSync(process.argv[2], 'utf8');
const { workouts, skipped } = parseGymKeeperTxt(txt);
console.log('workouts', workouts.length, 'skipped', skipped, workouts[0].date, '→', workouts.at(-1).date);
const names = new Set(workouts.flatMap(w => w.exercises.map(e => e.name)));
console.log('distinct names', names.size);
const today = '2026-11-14';
const ph = E.phaseFor(today, s);
for (const day of [6, 0, 2, 4]) {
  console.log(`\n== ${E.WEEKDAYS[day]} ${E.DEFAULT_TEMPLATES[day].title} | phases:`);
  for (const key of ['volume', 'hypertrophy', 'strength', 'deload']) {
    const row = E.DEFAULT_TEMPLATES[day].exercises.map(n => {
      const p = E.prescribe(n, key, workouts, s, today);
      return `${n.split(' · ')[0].slice(0, 18)}: ${p.sets}×${p.targetReps} @${p.weight ?? '?'}`;
    });
    console.log(' ', key.padEnd(11), row.join(' | '));
  }
}
console.log('\ntrends:', ['Bench Press · Barbell', 'Incline Bench Press · Dumbbell', 'Chest Dip', 'Pull Up (Wide Grip)'].map(n => n + ' ' + JSON.stringify(E.trend(n, workouts, today))).join('\n'));
console.log('\nsets/muscle/week:', E.weeklySetsByMuscle(workouts, today, 4));
console.log('freq', E.frequencyStats(workouts, today));
const z = E.repZoneResponse(workouts, ['Bench Press · Barbell', 'Incline Bench Press · Barbell', 'Incline Bench Press · Dumbbell', 'Pull Up (Wide Grip)', 'Pull Up', 'Chest Dip', 'Curl · Barbell'], today);
console.log('zones', JSON.stringify(z));
const plans = E.DEFAULT_TEMPLATES[6].exercises.map(n => ({ ...E.prescribe(n, ph.key, workouts, s, today), trend: E.trend(n, workouts, today) }));
console.log(E.adviceForToday({ plans, phaseInfo: ph, workouts, today, settings: s }));
console.log('ALL OK');
