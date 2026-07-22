import { describe, expect, it } from "vitest";
import { createEmptyMatch, defaultRuleSet, recordAdjudication } from "./rules";

describe("综合判定与警告转换", () => {
  it("一次综合判定支持双方多种警告，并消费完成转换的来源警告", () => {
    const match = createTestMatch();
    const result = recordAdjudication(match, {
      redScoreDelta: 2,
      blueScoreDelta: 1,
      redWarnings: { verbal: 1, yellow: 2 },
      blueWarnings: { red: 1 },
    }, defaultRuleSet);

    expect(result.redScore).toBe(1);
    expect(result.blueScore).toBe(0);
    expect(result.redWarnings).toEqual({ verbal: 1, red: 1 });
    expect(result.blueWarnings).toEqual({ red: 1 });
    expect(result.redPenalties).toBe(1);
    expect(result.bluePenalties).toBe(1);
  });

  it("转换可从黄牌连续推进到红牌再到黑牌", () => {
    const match = createTestMatch();
    const result = recordAdjudication(match, {
      redScoreDelta: 0,
      blueScoreDelta: 0,
      redWarnings: { yellow: 6 },
      blueWarnings: {},
    }, defaultRuleSet);

    expect(result.redWarnings).toEqual({ black: 1 });
    expect(result.status).toBe("finished");
    expect(result.winner).toBe("blue");
    expect(result.endReason).toBe("forfeit");
  });
});

function createTestMatch() {
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
