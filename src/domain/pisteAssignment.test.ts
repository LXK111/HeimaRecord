import { describe, expect, it } from "vitest";
import { createEmptyMatch } from "./rules";
import { assignGeneratedPistes, assignGroupStagePistes } from "./pisteAssignment";
import { defaultRuleSet } from "./rules";
import type { Match } from "../types";

describe("赛事场地分配", () => {
  it("小组场次不可拆分，并按小组场次数均衡负载", () => {
    const matches = [
      ...createMatches("A组", 10),
      ...createMatches("B组", 6),
      ...createMatches("C组", 6),
      ...createMatches("D组", 3),
    ];
    const assigned = assignGroupStagePistes(matches, 2);

    ["A组", "B组", "C组", "D组"].forEach((groupName) => {
      expect(new Set(assigned.filter((match) => match.groupName === groupName).map((match) => match.piste)).size).toBe(1);
    });
    const loads = ["场地 1", "场地 2"].map((piste) => assigned.filter((match) => match.piste === piste).length);
    expect(Math.max(...loads) - Math.min(...loads)).toBe(1);
  });

  it("后续场次基于已有负载逐场分配", () => {
    const existing = assignGeneratedPistes(createMatches("瑞士A组", 4), [], 3);
    const next = assignGeneratedPistes(createMatches("瑞士轮", 2), existing, 3);
    const all = [...existing, ...next];
    const loads = ["场地 1", "场地 2", "场地 3"].map((piste) => all.filter((match) => match.piste === piste).length);
    expect(loads).toEqual([2, 2, 2]);
  });
});

function createMatches(groupName: string, count: number): Match[] {
  return Array.from({ length: count }, (_, index) => ({
    ...createEmptyMatch({
      matchNo: `${groupName}-${index + 1}`,
      groupName,
      piste: "未分配",
      redName: `红${index + 1}`,
      redClub: "",
      blueName: `蓝${index + 1}`,
      blueClub: "",
      ruleSet: defaultRuleSet,
    }),
    tournamentStage: "group" as const,
  }));
}
