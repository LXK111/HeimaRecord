import { describe, expect, it } from "vitest";
import { createEmptyMatch, defaultRuleSet } from "../domain/rules";
import { createInitialState } from "./storage";
import { mergeTournamentResults } from "./resultImporter";
import { parseTournamentResultFile } from "./resultImporter";
import { buildTournamentResultsWorkbook } from "./exporter";
import type { ImportedResult } from "./resultImporter";

describe("分场地结果合并", () => {
  it("合并同赛事已结束场次，并忽略重复导入", () => {
    const state = createInitialState();
    const match = { ...createMatch(), eventId: state.event.id };
    state.matches = [match];
    const incoming = createResult(state.event.id, match.id, 5, 2);

    const first = mergeTournamentResults(state, [incoming]);
    expect(first.report).toMatchObject({ applied: 1, duplicates: 0, conflicts: [], eventMismatch: false });
    expect(first.state.matches[0]).toMatchObject({ status: "finished", redScore: 5, blueScore: 2, winner: "red" });

    const second = mergeTournamentResults(first.state, [incoming]);
    expect(second.report).toMatchObject({ applied: 0, duplicates: 1, conflicts: [] });
  });

  it("赛事 ID 不同或本机已有不同结果时只报告，不覆盖", () => {
    const state = createInitialState();
    const match = { ...createMatch(), eventId: state.event.id, status: "finished" as const, redScore: 3, blueScore: 1, winner: "red" as const, endReason: "manual" as const };
    state.matches = [match];

    const conflict = mergeTournamentResults(state, [createResult(state.event.id, match.id, 1, 4)]);
    expect(conflict.report.conflicts).toHaveLength(1);
    expect(conflict.state.matches[0].redScore).toBe(3);

    const mismatch = mergeTournamentResults(state, [createResult("another-event", match.id, 5, 0)]);
    expect(mismatch.report.eventMismatch).toBe(true);
    expect(mismatch.report.applied).toBe(0);
    expect(mismatch.state.matches[0].redScore).toBe(3);
  });

  it("项目导出的赛事结果工作簿可以被相同解析器回读", async () => {
    const state = createInitialState();
    const match = { ...createMatch(), eventId: state.event.id, status: "finished" as const, redScore: 5, blueScore: 2, winner: "red" as const, endReason: "manual" as const };
    state.matches = [match];
    const workbook = buildTournamentResultsWorkbook(state, []);
    const buffer = await workbook.xlsx.writeBuffer();

    const parsed = await parseTournamentResultFile({ name: "results.xlsx", arrayBuffer: async () => buffer as ArrayBuffer } as File);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ eventId: state.event.id, matchId: match.id, status: "finished", redScore: 5, blueScore: 2, winner: "red" });
  });
});

function createMatch() {
  return createEmptyMatch({
    matchNo: "1",
    groupName: "A组",
    piste: "场地 1",
    redName: "甲",
    redClub: "一队",
    blueName: "乙",
    blueClub: "二队",
    ruleSet: defaultRuleSet,
  });
}

function createResult(eventId: string, matchId: string, redScore: number, blueScore: number): ImportedResult {
  return {
    eventId,
    matchId,
    status: "finished",
    redScore,
    blueScore,
    redPenalties: 0,
    bluePenalties: 0,
    redWarnings: {},
    blueWarnings: {},
    winner: redScore > blueScore ? "red" : "blue",
    endReason: "manual",
    remainingSeconds: 30,
    isOvertime: false,
    currentRound: 1,
    roundRecords: [],
    events: [],
    updatedAt: "2026-07-22T10:00:00.000Z",
  };
}
