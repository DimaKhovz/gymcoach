"""Скачивает кадры упражнений из free-exercise-db (Unlicense, общественное достояние),
ужимает их в WebP и собирает данные для приложения.

Запуск из папки gymcoach:  python tools/build_media.py
Результат:
  img/ex/<код>-0.webp, -1.webp — кадры начала и конца движения (встроены в приложение);
                                 код — короткий хеш id, чтобы не упереться в длину пути Windows
  data/exdb-index.json         — список всех упражнений базы для поиска картинки
  data/instructions-en.json    — техника выполнения для встроенных упражнений (оригинал)
"""
import hashlib
import io
import json
import os
import sys
import urllib.request

from PIL import Image

BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/'
WIDTH = 360

# Название в дневнике -> id в free-exercise-db
MAPPING = {
    'Hyperextension': 'Hyperextensions_Back_Extensions',
    'Bench Press · Barbell': 'Barbell_Bench_Press_-_Medium_Grip',
    'Pull Up': 'Pullups',
    'Pull Up (Wide Grip)': 'Pullups',
    'Pull Up (Close Grip)': 'V-Bar_Pullup',
    'Chin Up': 'Chin-Up',
    'Incline Bench Press · Barbell': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
    'Incline Bench Press · Dumbbell': 'Incline_Dumbbell_Press',
    'Incline Bench Press · Smith Machine': 'Smith_Machine_Incline_Bench_Press',
    'Bench Press · Dumbbell': 'Dumbbell_Bench_Press',
    'Bench Press (Close Grip) · Barbell': 'Close-Grip_Barbell_Bench_Press',
    'Decline Bench Press · Dumbbell': 'Decline_Dumbbell_Bench_Press',
    'Decline Bench Press · Barbell': 'Decline_Barbell_Bench_Press',
    'Hammer Strength Press · Machine': 'Leverage_Chest_Press',
    'Chest Dip': 'Dips_-_Chest_Version',
    'Tricep Dip': 'Dips_-_Triceps_Version',
    'Pec Deck · Machine': 'Butterfly',
    'Chest Fly · Machine': 'Butterfly',
    'Standing Chest Fly · Cable': 'Cable_Crossover',
    'Lateral Raise · Dumbbell': 'Side_Lateral_Raise',
    'Lateral Raise · Cable': 'Cable_Seated_Lateral_Raise',
    'Front Raise · Dumbbell': 'Front_Dumbbell_Raise',
    'Face Pull · Cable': 'Face_Pull',
    'Reverse Fly · Machine': 'Reverse_Machine_Flyes',
    'Bent Over Reverse Fly · Dumbbell': 'Seated_Bent-Over_Rear_Delt_Raise',
    'Overhead Press · Barbell': 'Standing_Military_Press',
    'Seated Overhead Press · Barbell': 'Seated_Barbell_Military_Press',
    'Seated Overhead Press · Dumbbell': 'Seated_Dumbbell_Press',
    'Overhead Press · Dumbbell': 'Dumbbell_Shoulder_Press',
    'Overhead Press · Machine': 'Machine_Shoulder_Military_Press',
    'Arnold Press · Dumbbell': 'Arnold_Dumbbell_Press',
    'Upright Row · Barbell': 'Upright_Barbell_Row',
    'Shrug · Dumbbell': 'Dumbbell_Shrug',
    'Shrug · Machine': 'Leverage_Shrug',
    'Single Arm Bent Over Row · Dumbbell': 'One-Arm_Dumbbell_Row',
    'Bent Over Row · Barbell': 'Bent_Over_Barbell_Row',
    'Bent Over Row · T-Bar': 'T-Bar_Row_with_Handle',
    'Seated Row · Cable': 'Seated_Cable_Rows',
    'Seated Row · Machine': 'Leverage_Iso_Row',
    'Lat Pull Down · Machine': 'Wide-Grip_Lat_Pulldown',
    'Lat Pull Down · Cable': 'Wide-Grip_Lat_Pulldown',
    'Lat Pull Down (Close Grip) · Cable': 'Close-Grip_Front_Lat_Pulldown',
    'Deadlift · Barbell': 'Barbell_Deadlift',
    'Romanian Deadlift · Barbell': 'Romanian_Deadlift',
    'Curl · Barbell': 'Barbell_Curl',
    'Curl · Dumbbell': 'Dumbbell_Bicep_Curl',
    'Curl · Cable': 'Standing_Biceps_Cable_Curl',
    'Supinating Curl · Dumbbell': 'Dumbbell_Alternate_Bicep_Curl',
    'Incline Curl · Dumbbell': 'Incline_Dumbbell_Curl',
    'Hammer Curl · Dumbbell': 'Hammer_Curls',
    'Hammer Curl · Cable': 'Cable_Hammer_Curls_-_Rope_Attachment',
    'Pinwheel Curl · Dumbbell': 'Cross_Body_Hammer_Curl',
    'Reverse Curl · Barbell': 'Reverse_Barbell_Curl',
    'Preacher Curl · Barbell': 'Preacher_Curl',
    'Tricep Extension · Cable': 'Triceps_Pushdown',
    'Overhead Tricep Extension · Cable': 'Triceps_Overhead_Extension_with_Rope',
    'Seated Overhead Tricep Extension · Dumbbell': 'Seated_Triceps_Press',
    'Single Arm Overhead Triceps Extension · Dumbbell': 'Standing_One-Arm_Dumbbell_Triceps_Extension',
    'Lying Tricep Extension · Dumbbell': 'Lying_Dumbbell_Tricep_Extension',
    'Lying Tricep Extension · Barbell': 'Lying_Triceps_Press',
    'Tricep Kickback · Dumbbell': 'Tricep_Dumbbell_Kickback',
    'Squat · Barbell': 'Barbell_Squat',
    'Front Squat · Barbell': 'Front_Barbell_Squat',
    'Lunge · Dumbbell': 'Dumbbell_Lunges',
    'Leg Press · Machine': 'Leg_Press',
    'Leg Extension · Machine': 'Leg_Extensions',
    'Glute Bridge · Barbell': 'Barbell_Glute_Bridge',
    'Hip Thrust': 'Barbell_Hip_Thrust',
    'Standing Calf Raise · Machine': 'Standing_Calf_Raises',
    'Seated Calf Raise · Machine': 'Seated_Calf_Raise',
    'Hanging Knee Raise': 'Hanging_Leg_Raise',
    'Hanging Leg Raise': 'Hanging_Leg_Raise',
    'Decline Crunch': 'Decline_Crunch',
    'Decline Sit Up': 'Decline_Crunch',
    'Crunch · Stability Ball': 'Exercise_Ball_Crunch',
    'muscle up': 'Muscle_Up',
}


def short(ex_id):
    return hashlib.md5(ex_id.encode()).hexdigest()[:8]


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    db = json.loads(fetch(BASE + 'dist/exercises.json').decode('utf-8'))
    by_id = {x['id']: x for x in db}

    missing = sorted({i for i in MAPPING.values() if i not in by_id})
    if missing:
        sys.exit('Нет в базе: ' + ', '.join(missing))

    os.makedirs('data', exist_ok=True)
    instructions = {}
    total = 0
    for ex_id in sorted(set(MAPPING.values())):
        ex = by_id[ex_id]
        os.makedirs(os.path.join('img', 'ex'), exist_ok=True)
        for i, rel in enumerate(ex['images'][:2]):
            dst = os.path.join('img', 'ex', f'{short(ex_id)}-{i}.webp')
            if not os.path.exists(dst):
                im = Image.open(io.BytesIO(fetch(BASE + 'exercises/' + rel))).convert('RGB')
                h = round(im.height * WIDTH / im.width)
                im.resize((WIDTH, h), Image.LANCZOS).save(dst, 'WEBP', quality=72, method=6)
            total += os.path.getsize(dst)
        instructions[ex_id] = {'file': short(ex_id), 'name': ex['name'], 'muscles': ex['primaryMuscles'], 'steps': ex['instructions']}
        print('ok', ex_id)

    index = [[x['id'], x['name'], (x['primaryMuscles'] or [''])[0], x.get('equipment') or '', len(x['images'])]
             for x in db if x.get('images')]
    with open('data/exdb-index.json', 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    with open('data/instructions-en.json', 'w', encoding='utf-8') as f:
        json.dump(instructions, f, ensure_ascii=False, indent=1)
    with open('data/mapping.json', 'w', encoding='utf-8') as f:
        json.dump(MAPPING, f, ensure_ascii=False, indent=1)
    print(f'{len(instructions)} упражнений, картинки {total / 1024 / 1024:.1f} МБ, в индексе {len(index)}')


if __name__ == '__main__':
    main()
