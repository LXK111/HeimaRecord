import { describe, expect, it } from "vitest";
import { defaultRuleSet } from "./rules";
import {
  advanceBracket,
  calculateRankings,
  countGroupClubConflicts,
  createTournamentPlayer,
  generateDirectEliminationBracket,
  generateDoubleEliminationBracket,
  generateGroupStage,
  generateNextSwissRound,
  generateSwissFirstRound,
  lockCurrentSwissRound,
  refreshTournamentRankings,
  syncTournamentEvent,
} from "./tournament";
import { buildArrangementWorkbook, buildTournamentResultsWorkbook } from "../services/exporter";
import { createDefaultTournamentEvent, createInitialState } from "../services/storage";
import type { Match, TournamentEvent, TournamentFormat } from "../types";

describe("赛事编排验收", () => {
  it("为 12 名选手生成两个六人小组并计算四名晋级者", () => {
    const event = createEvent("group_bracket", 12, {
      groupSize: 6,
      groupAdvancers: 2,
      totalAdvancers: 4,
    });
    const generated = generateGroupStage(event, defaultRuleSet);

    expect(generated.event.groupNames).toEqual(["A组", "B组"]);
    expect(generated.matches).toHaveLength(30);
    generated.event.groupNames.forEach((groupName) => {
      expect(generated.matches.filter((match) => match.groupName === groupName)).toHaveLength(15);
    });

    const finishedMatches = finishPendingMatches(generated.matches);
    const rankedEvent = refreshTournamentRankings(generated.event, finishedMatches, defaultRuleSet);
    expect(rankedEvent.stage).toBe("group_finished");
    expect(rankedEvent.rankings).toHaveLength(12);
    expect(rankedEvent.rankings.filter((ranking) => ranking.advanced)).toHaveLength(4);
  });

  it("瑞士轮必须先锁定当前轮，且下一轮不会重复对阵", () => {
    const event = createEvent("swiss_bracket", 8, { swissRounds: 2, swissAdvancers: 4, pisteCount: 2 });
    const firstRound = generateSwissFirstRound(event, defaultRuleSet, []);
    expect(firstRound.matches).toHaveLength(4);
    expect(new Set(firstRound.matches.map((match) => match.groupName))).toEqual(new Set(["瑞士A组", "瑞士B组"]));
    expect(firstRound.event.groupNames).toEqual(["瑞士轮"]);
    expect(generateNextSwissRound(firstRound.event, firstRound.matches, defaultRuleSet).matches).toHaveLength(0);

    const firstRoundMatches = finishPendingMatches(firstRound.matches);
    const lockedFirstRound = lockCurrentSwissRound(firstRound.event, firstRoundMatches, defaultRuleSet);
    expect(lockedFirstRound.swissRounds[0].status).toBe("locked");

    const secondRound = generateNextSwissRound(lockedFirstRound, firstRoundMatches, defaultRuleSet);
    expect(secondRound.matches).toHaveLength(4);
    expect(new Set(secondRound.matches.map((match) => match.groupName))).toEqual(new Set(["瑞士A组", "瑞士B组"]));
    const firstPairings = new Set(firstRoundMatches.map(pairingKey));
    secondRound.matches.forEach((match) => expect(firstPairings.has(pairingKey(match))).toBe(false));

    const allMatches = [...firstRoundMatches, ...finishPendingMatches(secondRound.matches)];
    const finishedEvent = lockCurrentSwissRound(secondRound.event, allMatches, defaultRuleSet);
    expect(finishedEvent.stage).toBe("swiss_finished");
    expect(calculateRankings(finishedEvent, allMatches, defaultRuleSet)).toHaveLength(8);
  });

  it("瑞士轮首轮可忽略种子随机配对，且轮空规则保持不变", () => {
    const event = createEvent("swiss_bracket", 8, { useSeeding: true });
    const seededRound = generateSwissFirstRound(event, defaultRuleSet, [], () => 0);
    const randomEvent = {
      ...event,
      formatConfig: { ...event.formatConfig, useSeeding: false },
    };
    const randomizedRound = generateSwissFirstRound(randomEvent, defaultRuleSet, [], () => 0);

    expect(randomizedRound.matches.map(pairingKey)).not.toEqual(seededRound.matches.map(pairingKey));
    expect(new Set(randomizedRound.matches.flatMap((match) => [match.redPlayerId, match.bluePlayerId])).size).toBe(8);
    expect(randomizedRound.matches.every((match) => match.events[0]?.label.includes("随机配对"))).toBe(true);

    const oddEvent = createEvent("swiss_bracket", 5, { useSeeding: false });
    const oddRound = generateSwissFirstRound(oddEvent, defaultRuleSet, [], () => 0.5);
    expect(oddEvent.players.map((player) => player.id)).toContain(oddRound.event.swissRounds[0].byePlayerId);
    expect(oddRound.matches.flatMap((match) => [match.redPlayerId, match.bluePlayerId])).not.toContain(oddRound.event.swissRounds[0].byePlayerId);
  });

  it("10 人直接单败生成六个轮空并完成季军赛", () => {
    const event = createEvent("direct_bracket", 10, { generateThirdPlaceMatch: true });
    const initial = generateDirectEliminationBracket(event, [], defaultRuleSet);
    expect(initial.event.bracketNodes.filter((node) => node.status === "bye")).toHaveLength(6);
    expect(initial.matches).toHaveLength(2);

    const completed = completeElimination(initial.event, initial.matches);
    expect(completed.event.stage).toBe("finished");
    expect(completed.event.bracketNodes.filter((node) => node.label === "决赛")).toHaveLength(1);
    expect(completed.event.bracketNodes.filter((node) => node.stage === "third_place")).toHaveLength(1);

    const state = { ...createInitialState(), event: completed.event, matches: completed.matches };
    const workbook = buildTournamentResultsWorkbook(state, []);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["赛事摘要", "最终名次", "预赛排名", "淘汰签表", "全部场次"]);
    expect(workbook.getWorksheet("赛事摘要")?.getCell("B10").value).toBe("赛事已完成");
    expect(workbook.getWorksheet("预赛排名")?.rowCount).toBe(1);
  });

  it("直接淘汰默认随机抽签，启用种子后按种子固定签位", () => {
    const randomEvent = createEvent("direct_bracket", 8, { useSeeding: false, pisteCount: 3 });
    const seededEvent = { ...randomEvent, formatConfig: { ...randomEvent.formatConfig, useSeeding: true } };
    const randomized = generateDirectEliminationBracket(randomEvent, [], defaultRuleSet, () => 0);
    const seeded = generateDirectEliminationBracket(seededEvent, [], defaultRuleSet, () => 0);

    expect(randomized.matches.map(pairingKey)).not.toEqual(seeded.matches.map(pairingKey));
    expect(randomized.event.rankings.map((ranking) => ranking.playerId)).not.toEqual(seeded.event.rankings.map((ranking) => ranking.playerId));
    const pisteLoads = ["场地 1", "场地 2", "场地 3"].map((piste) => randomized.matches.filter((match) => match.piste === piste).length);
    expect(pisteLoads).toEqual([2, 1, 1]);
  });

  it("双败累计两负淘汰，并且只生成一场总决赛", () => {
    const event = createEvent("double_elimination", 4);
    const initial = generateDoubleEliminationBracket(event, [], defaultRuleSet);
    const completed = completeElimination(initial.event, initial.matches);
    const grandFinalNodes = completed.event.bracketNodes.filter((node) => node.stage === "grand_final");

    expect(completed.event.stage).toBe("finished");
    expect(grandFinalNodes).toHaveLength(1);
    expect(grandFinalNodes[0].status).toBe("finished");

    const losses = new Map<string, number>();
    completed.event.bracketNodes.forEach((node) => {
      if (node.status === "finished" && node.loserPlayerId) {
        losses.set(node.loserPlayerId, (losses.get(node.loserPlayerId) ?? 0) + 1);
      }
    });
    const championId = grandFinalNodes[0].winnerPlayerId;
    completed.event.players.filter((player) => player.id !== championId).forEach((player) => {
      expect(losses.get(player.id)).toBe(2);
    });
  });

  it("未完赛工作簿明确标记结果状态", () => {
    const event = createEvent("direct_bracket", 2);
    const state = { ...createInitialState(), event };
    const workbook = buildTournamentResultsWorkbook(state, []);

    expect(workbook.getWorksheet("赛事摘要")?.getCell("B10").value).toBe("未完赛结果");
  });

  it("小组赛尽量规避同单位，并保持整组位于同一场地", () => {
    const event = createEvent("group_bracket", 8, { groupSize: 4, pisteCount: 2, avoidClubInGroups: true, useSeeding: true });
    event.players = event.players.map((player, index) => ({ ...player, club: `单位${index % 4}` }));
    const generated = generateGroupStage(event, defaultRuleSet, () => 0);

    generated.event.groupNames.forEach((groupName) => {
      const groupPlayers = generated.event.players.filter((player) => player.groupName === groupName);
      expect(new Set(groupPlayers.map((player) => player.club)).size).toBe(groupPlayers.length);
      expect(new Set(generated.matches.filter((match) => match.groupName === groupName).map((match) => match.piste)).size).toBe(1);
    });
    const pisteLoads = ["场地 1", "场地 2"].map((piste) => generated.matches.filter((match) => match.piste === piste).length);
    expect(pisteLoads).toEqual([6, 6]);
  });

  it("同单位无法完全拆开时仍保持组容量并返回最少冲突", () => {
    const event = createEvent("group_bracket", 4, { groupSize: 2, avoidClubInGroups: true, useSeeding: true });
    event.players = event.players.map((player) => ({ ...player, club: "同一单位" }));
    const generated = generateGroupStage(event, defaultRuleSet, () => 0);

    expect(generated.event.groupNames.map((groupName) => generated.event.players.filter((player) => player.groupName === groupName).length)).toEqual([2, 2]);
    expect(countGroupClubConflicts(generated.event.players)).toBe(2);
  });

  it("编排导出包含场次明细和场地统计", () => {
    const event = createEvent("group_bracket", 8, { groupSize: 4, pisteCount: 2 });
    const generated = generateGroupStage(event, defaultRuleSet, () => 0);
    const workbook = buildArrangementWorkbook({ ...createInitialState(), event: generated.event, matches: generated.matches });

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["编排场次", "场地统计"]);
    expect(workbook.getWorksheet("编排场次")?.rowCount).toBe(13);
    expect(workbook.getWorksheet("场地统计")?.rowCount).toBe(3);

    const adjustedMatches = generated.matches.map((match, index) => index === 0 ? { ...match, piste: "主场" } : match);
    const adjustedWorkbook = buildArrangementWorkbook({ ...createInitialState(), event: generated.event, matches: adjustedMatches });
    expect(adjustedWorkbook.getWorksheet("场地统计")?.rowCount).toBe(4);
    expect(adjustedWorkbook.getWorksheet("场地统计")?.getCell("A4").value).toBe("主场");
  });
});

function createEvent(
  format: TournamentFormat,
  playerCount: number,
  formatOverrides: Partial<TournamentEvent["formatConfig"]> = {}
): TournamentEvent {
  const event = createDefaultTournamentEvent();
  return {
    ...event,
    players: Array.from({ length: playerCount }, (_, index) => createTournamentPlayer({
      name: `选手${index + 1}`,
      club: `单位${index + 1}`,
      seed: index + 1,
    })),
    formatConfig: { ...event.formatConfig, format, ...formatOverrides },
  };
}

function finishPendingMatches(matches: Match[]) {
  return matches.map((match) => match.status === "finished" ? match : {
    ...match,
    redScore: 5,
    blueScore: 1,
    status: "finished" as const,
    winner: "red" as const,
    endReason: "manual" as const,
  });
}

function completeElimination(initialEvent: TournamentEvent, initialMatches: Match[]) {
  let event = initialEvent;
  let matches = initialMatches;

  // 每一波待赛场次全部结束后再推进，模拟现场签表的真实状态机约束。
  for (let step = 0; step < 12; step += 1) {
    matches = finishPendingMatches(matches);
    event = syncTournamentEvent(event, matches);
    if (event.stage === "finished") return { event, matches };

    const next = advanceBracket(event, matches, defaultRuleSet);
    expect(next.matches.length).toBeGreaterThan(0);
    event = next.event;
    matches = [...matches, ...next.matches];
  }

  throw new Error("淘汰赛未在预期步数内结束");
}

function pairingKey(match: Match) {
  return [match.redPlayerId, match.bluePlayerId].sort().join(":");
}
