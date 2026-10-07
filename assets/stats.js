// Статистику страницы считают сами из файлов планов; AI ведёт только словари:
// muscle-map.json (упражнение → основная мышца) и log/<атлет>/series.json (серии прогресса).

const HARD_SET_MAX_RIR = 3;
const MAX_REPS_FOR_ONE_REP_MAX = 12;
const MACHINE_BASE_KG = 1;
const PLATE_KG = 5;

// Упражнение «на выбор» выполняется одним снарядом: отмеченным при записи факта, иначе первым.
function performedVariant(exercise) {
  const variants = exercise.variants || [];
  return variants.find(variant => variant.performed) || variants[0];
}

function workingBlocks(variant) {
  const blocks = variant?.loadBlocks || [];
  const exerciseHasWeight = blocks.some(hasWeight);
  return blocks.filter(block => !isWarmup(block, exerciseHasWeight));
}

function isWarmup(block, exerciseHasWeight) {
  const notes = `${block.note || ""} ${block.postNotes || ""}`.toLowerCase();
  return block.type === "warmup"
    || typeof block.rir === "string"
    || notes.includes("разминк") || notes.includes("подвод")
    || (exerciseHasWeight && !hasWeight(block));
}

function hasWeight(block) {
  return Boolean(block.weight);
}

function isOnMachineBase(block) {
  return (block.note || "").includes("базовый вес тренажёра");
}

// Пустой стек тренажёра или вес тела — 1 кг; блины «сверх базового веса тренажёра» — плюс этот 1 кг.
function loadedWeight(block) {
  if (!hasWeight(block)) return MACHINE_BASE_KG;
  const overMachineBase = (block.note || "").includes("сверх базового веса тренажёра");
  return block.weight + (overMachineBase ? MACHINE_BASE_KG : 0);
}

// Вес в кг на оба снаряда: гантели и стороны ×2, плитки ×5.
function totalKg(block) {
  const factor = { kg_per_hand: 2, kg_per_side: 2, plates: PLATE_KG }[block.unit] || 1;
  return loadedWeight(block) * factor;
}

// Вес в единице серии прогресса: «на руку» и «на сторону» не пересчитываются, плитки → кг.
function seriesWeight(block) {
  return loadedWeight(block) * (block.unit === "plates" ? PLATE_KG : 1);
}

function estimatedOneRepMax(weight, block, missingRir) {
  if (block.reps > MAX_REPS_FOR_ONE_REP_MAX) return null;
  return weight * (1 + (block.reps + (block.rir ?? missingRir)) / 30);
}

// Сводка микроцикла — по всем сессиям файла, у запланированных по назначенным весам.
// Нет rir → 1.5. Тоннаж и интенсивность округляются до целого.
export function microcycleStats(plan, muscleOf) {
  const exercises = plan.sessions
    .flatMap(session => session.workout || [])
    .map(exercise => ({ name: exercise.name, blocks: workingBlocks(performedVariant(exercise)) }))
    .filter(exercise => exercise.blocks.length);
  const sets = exercises.flatMap(exercise => workingSets(exercise, muscleOf[exercise.name]));
  const measured = sets.filter(set => set.intensity !== null);

  return {
    tonnageKg: Math.round(sum(sets, set => set.tonnageKg)),
    avgIntensityPct: measured.length ? Math.round(sum(measured, set => set.intensity) / measured.length * 100) : 0,
    hardSets: sets.filter(set => set.hard).length,
    hardSetsByMuscle: totalsByMuscle(sets, set => (set.hard ? 1 : 0)),
    tonnageByMuscleKg: totalsByMuscle(sets, set => set.tonnageKg),
    unmapped: [...new Set(exercises.filter(exercise => !muscleOf[exercise.name]).map(exercise => exercise.name))],
  };
}

// Подход с rir ≤ 3 — рабочий «тяжёлый»; интенсивность — вес / лучший расчётный 1ПМ упражнения в этот день.
function workingSets({ blocks }, muscle) {
  const MISSING_RIR = 1.5;
  const oneRepMaxes = blocks.filter(hasWeight)
    .map(block => estimatedOneRepMax(totalKg(block), block, MISSING_RIR))
    .filter(value => value !== null);
  const exerciseOneRepMax = oneRepMaxes.length ? Math.max(...oneRepMaxes) : null;
  return blocks.flatMap(block => Array.from({ length: block.sets }, () => ({
    muscle,
    tonnageKg: totalKg(block) * block.reps,
    hard: (block.rir ?? MISSING_RIR) <= HARD_SET_MAX_RIR,
    intensity: exerciseOneRepMax ? totalKg(block) / exerciseOneRepMax : null,
  })));
}

function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}

function totalsByMuscle(sets, value) {
  const totals = {};
  for (const set of sets.filter(set => set.muscle)) totals[set.muscle] = (totals[set.muscle] || 0) + value(set);
  return Object.fromEntries(Object.entries(totals)
    .map(([muscle, total]) => [muscle, Math.round(total)])
    .sort(([, a], [, b]) => b - a));
}

// Прогресс: одна серия — одно упражнение в одной колее снаряда («название / снаряд» в aliases).
// По каждой выполненной тренировке точка: max — самый тяжёлый рабочий подход, onepr — расчётный 1ПМ
// (reps ≤ 12, нет rir → 0, округление до 1 кг). День без веса (кроме базового веса тренажёра) точки не даёт.
export function progressReport(plans, seriesList) {
  const performedSessions = plans.flatMap(plan => plan.sessions)
    .filter(session => session.performedAt)
    .sort((a, b) => a.globalNumber - b.globalNumber);
  const weightedExercises = performedSessions.flatMap(session => (session.workout || []).map(exercise => {
    const variant = performedVariant(exercise);
    return {
      sessionId: session.sessionId,
      seriesKeys: variant?.label ? [`${exercise.name} / ${variant.label}`, exercise.name] : [exercise.name],
      blocks: workingBlocks(variant),
    };
  })).filter(exercise => exercise.blocks.some(block => hasWeight(block) || isOnMachineBase(block)));
  const seriesOf = exercise => exercise.seriesKeys
    .map(key => seriesList.find(series => series.aliases.includes(key)))
    .find(Boolean);

  return {
    sessions: performedSessions.map(session => ({
      id: session.sessionId, globalNumber: session.globalNumber, date: session.performedAt.slice(0, 10),
    })),
    exercises: seriesList
      .map(series => ({
        ...series,
        data: weightedExercises.filter(exercise => seriesOf(exercise) === series)
          .map(exercise => ({ sessionId: exercise.sessionId, ...dayPoint(exercise.blocks) })),
      }))
      .filter(series => series.data.length),
    unmapped: [...new Set(weightedExercises.filter(exercise => !seriesOf(exercise)).map(exercise => exercise.seriesKeys[0]))],
  };
}

function dayPoint(blocks) {
  const MISSING_RIR = 0;
  const oneRepMaxes = blocks
    .map(block => estimatedOneRepMax(seriesWeight(block), block, MISSING_RIR))
    .filter(value => value !== null);
  return {
    max: Math.max(...blocks.map(seriesWeight)),
    onepr: oneRepMaxes.length ? Math.round(Math.max(...oneRepMaxes)) : null,
  };
}
