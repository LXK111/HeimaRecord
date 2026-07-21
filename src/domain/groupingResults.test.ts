import { describe, expect, it } from "vitest";
import { defaultRuleSet } from "./rules";
import { buildTournamentGroupingResults, hasGroupingResults } from "./groupingResults";
import { createTournamentPlayer, generateGroupStage, generateSwissFirstRound } from "./tournament";
import { createDefaultTournamentEvent } from "../services/storage";
import { buildGroupingResultsWorkbook } from "../services/exporter";

describe("选手分组结果", () => {
  it("小组循环按固定小组输出完整选手名单", () => {
    const event = createEvent(8, "group_bracket");
    event.formatConfig.groupSize = 4;
    const generated = generateGroupStage(event, defaultRuleSet);

    const results = buildTournamentGroupingResults(generated.event, generated.matches);

    expect(results.kind).toBe("group");
    if (results.kind !== "group") return;
    expect(results.groups.map((group) => group.name)).toEqual(["A组", "B组"]);
    expect(results.groups.map((group) => group.players.length)).toEqual([4, 4]);
    expect(new Set(results.groups.flatMap((group) => group.players.map((player) => player.id))).size).toBe(8);
    expect(hasGroupingResults(results)).toBe(true);
  });

  it("瑞士轮按每轮现场分组输出对阵，并单独标记轮空选手", () => {
    const event = createEvent(5, "swiss_bracket");
    event.formatConfig.swissGroupCount = 2;
    const generated = generateSwissFirstRound(event, defaultRuleSet, []);

    const results = buildTournamentGroupingResults(generated.event, generated.matches);

    expect(results.kind).toBe("swiss");
    if (results.kind !== "swiss") return;
    expect(results.rounds).toHaveLength(1);
    expect(results.rounds[0].groups.map((group) => group.name)).toEqual(["瑞士A组", "瑞士B组"]);
    expect(results.rounds[0].groups.flatMap((group) => group.matches)).toHaveLength(2);
    expect(results.rounds[0].byePlayer?.name).toBeTruthy();
  });

  it("瑞士轮结果读取场次最新的现场分组和场地", () => {
    const event = createEvent(4, "swiss_bracket");
    const generated = generateSwissFirstRound(event, defaultRuleSet, []);
    const adjustedMatches = generated.matches.map((match, index) => index === 0
      ? { ...match, groupName: "主场", piste: "场地 1" }
      : match);

    const results = buildTournamentGroupingResults(generated.event, adjustedMatches);

    expect(results.kind).toBe("swiss");
    if (results.kind !== "swiss") return;
    expect(results.rounds[0].groups[0].name).toBe("主场");
    expect(results.rounds[0].groups[0].matches[0].piste).toBe("场地 1");
  });

  it("导出小组名单和逐轮瑞士分组工作表", () => {
    const groupGenerated = generateGroupStage(createEvent(8, "group_bracket"), defaultRuleSet);
    const groupWorkbook = buildGroupingResultsWorkbook({
      name: "测试赛事",
      ruleSet: defaultRuleSet,
      event: groupGenerated.event,
      matches: groupGenerated.matches,
      selectedMatchId: null,
      updatedAt: new Date().toISOString(),
    });
    expect(groupWorkbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["小组分组结果"]);
    expect(groupWorkbook.getWorksheet("小组分组结果")?.rowCount).toBe(9);

    const swissGenerated = generateSwissFirstRound(createEvent(5, "swiss_bracket"), defaultRuleSet, []);
    const swissWorkbook = buildGroupingResultsWorkbook({
      name: "测试赛事",
      ruleSet: defaultRuleSet,
      event: swissGenerated.event,
      matches: swissGenerated.matches,
      selectedMatchId: null,
      updatedAt: new Date().toISOString(),
    });
    expect(swissWorkbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["瑞士第1轮"]);
    expect(swissWorkbook.getWorksheet("瑞士第1轮")?.rowCount).toBe(4);
  });
});

function createEvent(playerCount: number, format: "group_bracket" | "swiss_bracket") {
  const event = createDefaultTournamentEvent();
  return {
    ...event,
    players: Array.from({ length: playerCount }, (_, index) => createTournamentPlayer({
      name: `选手${index + 1}`,
      club: `单位${index + 1}`,
      seed: index + 1,
    })),
    formatConfig: { ...event.formatConfig, format },
  };
}
