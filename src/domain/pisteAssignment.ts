import type { Match } from "../types";

type PisteLoad = {
  index: number;
  count: number;
};

export function normalizePisteCount(value: number) {
  return Math.min(26, Math.max(1, Math.trunc(value || 1)));
}

export function pisteLabel(index: number) {
  return `场地 ${index + 1}`;
}

export function assignGroupStagePistes(matches: Match[], pisteCount: number): Match[] {
  const loads = createPisteLoads(pisteCount);
  const matchesByGroup = new Map<string, Match[]>();
  matches.forEach((match) => {
    matchesByGroup.set(match.groupName, [...(matchesByGroup.get(match.groupName) ?? []), match]);
  });

  const pisteByGroup = new Map<string, number>();
  [...matchesByGroup.entries()]
    .sort(([groupA, matchesA], [groupB, matchesB]) => matchesB.length - matchesA.length || groupA.localeCompare(groupB, "zh-CN"))
    .forEach(([groupName, groupMatches]) => {
      // 小组不可拆分；按场次数从大到小放入当前负载最少的场地。
      const target = leastLoadedPiste(loads);
      pisteByGroup.set(groupName, target.index);
      target.count += groupMatches.length;
    });

  return matches.map((match) => ({ ...match, piste: pisteLabel(pisteByGroup.get(match.groupName) ?? 0) }));
}

export function assignGeneratedPistes(generatedMatches: Match[], existingMatches: Match[], pisteCount: number): Match[] {
  const loads = createPisteLoads(pisteCount);
  existingMatches
    .filter((match) => match.tournamentStage)
    .forEach((match) => {
      const pisteIndex = parsePisteIndex(match.piste, loads.length);
      if (pisteIndex !== null) loads[pisteIndex].count += 1;
    });

  return generatedMatches.map((match) => {
    const target = leastLoadedPiste(loads);
    target.count += 1;
    return { ...match, piste: pisteLabel(target.index) };
  });
}

function createPisteLoads(pisteCount: number): PisteLoad[] {
  return Array.from({ length: normalizePisteCount(pisteCount) }, (_, index) => ({ index, count: 0 }));
}

function leastLoadedPiste(loads: PisteLoad[]) {
  return loads.reduce((best, current) => current.count < best.count ? current : best, loads[0]);
}

function parsePisteIndex(value: string, pisteCount: number) {
  const match = /^场地\s+(\d+)$/.exec(value.trim());
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < pisteCount ? index : null;
}
