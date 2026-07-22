import { describe, expect, it } from "vitest";
import { createEmptyMatch, defaultRuleSet } from "./rules";
import { getNextMatchOnSamePiste, startTournament } from "./tournamentLifecycle";
import { createInitialState } from "../services/storage";

describe("赛事生命周期", () => {
  it("开始赛事后冻结规则且不会重复改写开始时间", () => {
    const state = createInitialState();
    const started = startTournament(state, "2026-07-22T10:00:00.000Z");
    const repeated = startTournament(started, "2026-07-22T11:00:00.000Z");

    expect(repeated.event.startedAt).toBe("2026-07-22T10:00:00.000Z");
    expect(repeated.event.rulesLockedAt).toBe("2026-07-22T10:00:00.000Z");
  });

  it("仅在当前比赛结束后返回同一场地最早的待赛场次", () => {
    const current = { ...createMatch("2", "场地 1"), eventId: "event-a", status: "finished" as const };
    const next = { ...createMatch("3", "场地 1"), eventId: "event-a" };
    const later = { ...createMatch("10", "场地 1"), eventId: "event-a" };
    const otherPiste = { ...createMatch("1", "场地 2"), eventId: "event-a" };
    const otherEvent = { ...createMatch("1", "场地 1"), eventId: "event-b" };

    expect(getNextMatchOnSamePiste([later, otherPiste, otherEvent, next], current)?.matchNo).toBe("3");
    expect(getNextMatchOnSamePiste([later, otherPiste, next], { ...current, status: "paused" })).toBeNull();
  });
});

function createMatch(matchNo: string, piste: string) {
  return createEmptyMatch({
    matchNo,
    groupName: "A组",
    piste,
    redName: `红${matchNo}`,
    redClub: "",
    blueName: `蓝${matchNo}`,
    blueClub: "",
    ruleSet: defaultRuleSet,
  });
}
