// Тренд нагрузки по микроциклам — те же цифры, что в сводке coach.html: node tools/load-trend.mjs <атлет>
import { readFileSync } from "node:fs";
import { microcycleStats } from "../assets/stats.js";

const athlete = process.argv[2];
const readJson = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));

const muscleOf = readJson("muscle-map.json")[athlete];
const cycles = readJson(`log/${athlete}/index.json`).plans.map(record => {
  const plan = readJson(`log/${athlete}/${record.file}`);
  const unfinished = plan.sessions.some(session => !session.performedAt);
  return { label: `${Number(plan.planId)}${unfinished ? "*" : ""}`, stats: microcycleStats(plan, muscleOf) };
});

const change = (current, previous) => {
  if (!previous) return "";
  const sign = current >= previous ? "+" : "−";
  return ` (${sign}${Math.round(Math.abs(current - previous) / previous * 100)}%)`;
};
const table = (header, rows) => [header, header.map(() => "---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");

console.log("* — микроцикл не закончен, невыполненные сессии посчитаны по назначенным весам\n");
console.log(table(["Микроцикл", "Тоннаж, кг", "Интенсивность, %", "Рабочих подходов"], cycles.map(({ label, stats }, i) => {
  const previous = cycles[i - 1]?.stats;
  return [
    label,
    `${stats.tonnageKg}${change(stats.tonnageKg, previous?.tonnageKg)}`,
    stats.avgIntensityPct,
    `${stats.hardSets}${change(stats.hardSets, previous?.hardSets)}`,
  ];
})));

const muscles = [...new Set(cycles.flatMap(({ stats }) => Object.keys(stats.hardSetsByMuscle)))];
const byMuscle = (title, totalsOf) => {
  console.log(`\n${title}\n`);
  console.log(table(["Мышца", ...cycles.map(cycle => cycle.label)],
    muscles.map(muscle => [muscle, ...cycles.map(({ stats }) => totalsOf(stats)[muscle] ?? 0)])));
};
byMuscle("Рабочие подходы по мышцам", stats => stats.hardSetsByMuscle);
byMuscle("Тоннаж по мышцам, кг", stats => stats.tonnageByMuscleKg);

const unmapped = [...new Set(cycles.flatMap(({ stats }) => stats.unmapped))];
if (unmapped.length) console.log(`\nНе сопоставлено с мышцей (дописать в muscle-map.json): ${unmapped.join(", ")}`);
