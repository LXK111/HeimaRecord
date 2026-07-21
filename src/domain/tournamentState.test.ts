import { describe, expect, it } from "vitest";
import { createEmptyMatch, defaultRuleSet } from "./rules";
import { createTournamentPlayer } from "./tournament";
import {
  clearTournamentArrangement,
  getTournamentProgress,
  removeImportedMatches,
  resetTournamentState,
  updateArrangementMatch,
} from "./tournamentState";
import { createInitialState } from "../services/storage";
import type { Match, TournamentState } from "../types";

describe("赛事状态操作", () => {
  it("清空编排只删除赛事生成场次，并保留名单和普通导入场次", () => {
    const imported = createMatch("imported");
    const generated = { ...createMatch("generated"), tournamentStage: "group" as const };
    const state = createState([imported, generated]);
    state.event.players = [{ ...createTournamentPlayer({ name: "甲", club: "黑马", seed: 1 }), groupName: "A组" }];
    state.event.groupNames = ["A组"];
    state.event.rankings = [{
      rank: 1, playerId: state.event.players[0].id, name: "甲", club: "黑马", groupName: "A组",
      eventPoints: 3, realWins: 1, draws: 0, losses: 0, scoreFor: 5, scoreAgainst: 1,
      scoreDiff: 4, disciplinePenalty: 0, advanced: true, needsPlayoff: false,
    }];
    state.selectedMatchId = generated.id;

    const cleared = clearTournamentArrangement(state);

    expect(cleared.matches.map((match) => match.id)).toEqual([imported.id]);
    expect(cleared.selectedMatchId).toBe(imported.id);
    expect(cleared.event.players[0].groupName).toBe("");
    expect(cleared.event.stage).toBe("setup");
    expect(cleared.event.groupNames).toEqual([]);
    expect(cleared.event.rankings).toEqual([]);
  });

  it("删除普通场次不会删除赛事生成场次，并会修正当前选中场次", () => {
    const imported = createMatch("imported");
    const generated = { ...createMatch("generated"), tournamentStage: "swiss" as const };
    const state = createState([imported, generated]);
    state.selectedMatchId = imported.id;

    const next = removeImportedMatches(state, [imported.id, generated.id]);

    expect(next.matches.map((match) => match.id)).toEqual([generated.id]);
    expect(next.selectedMatchId).toBe(generated.id);
  });

  it("赛事重置保留当前规则，但清空名单、场次和编排", () => {
    const state = createState([createMatch("imported")]);
    state.ruleSet = { ...defaultRuleSet, targetScore: 12 };
    state.event.players = [createTournamentPlayer({ name: "甲", club: "黑马", seed: 1 })];

    const reset = resetTournamentState(state, createInitialState());

    expect(reset.ruleSet.targetScore).toBe(12);
    expect(reset.matches).toEqual([]);
    expect(reset.event.players).toEqual([]);
    expect(reset.event.stage).toBe("setup");
  });

  it("只允许编辑未开始的赛事场次编排字段", () => {
    const pending = { ...createMatch("pending"), tournamentStage: "group" as const };
    const finished = { ...createMatch("finished"), tournamentStage: "group" as const, status: "finished" as const };
    const imported = createMatch("imported");
    let state = createState([pending, finished, imported]);

    state = updateArrangementMatch(state, pending.id, { matchNo: "A-01", groupName: "一号场", piste: "场地 1" });
    state = updateArrangementMatch(state, finished.id, { piste: "不应修改" });
    state = updateArrangementMatch(state, imported.id, { piste: "不应修改" });

    expect(state.matches[0]).toMatchObject({ matchNo: "A-01", groupName: "一号场", piste: "场地 1" });
    expect(state.matches[1].piste).toBe("一号场");
    expect(state.matches[2].piste).toBe("一号场");
  });

  it("按全部场次统计完成进度", () => {
    const finished = { ...createMatch("finished"), status: "finished" as const };
    const state = createState([finished, createMatch("pending"), createMatch("pending-2")]);
    expect(getTournamentProgress(state)).toEqual({ total: 3, completed: 1, percent: 33 });
  });
});

function createState(matches: Match[]): TournamentState {
  return { ...createInitialState(), matches, selectedMatchId: matches[0]?.id ?? null };
}

function createMatch(id: string): Match {
  return {
    ...createEmptyMatch({
      matchNo: id,
      groupName: "A组",
      piste: "一号场",
      redName: "甲",
      redClub: "黑马",
      blueName: "乙",
      blueClub: "黑马",
      ruleSet: defaultRuleSet,
    }),
    id,
  };
}
