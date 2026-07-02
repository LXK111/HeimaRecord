import type { Match, RuleSet, Winner, MatchEndReason } from "../types";

export const defaultRuleSet: RuleSet = {
  durationSeconds: 180,
  targetScore: 10,
  allowDraw: false,
  enableOvertime: true,
  overtimeSeconds: 60,
  penaltyDeduction: 1,
  maxPenaltyCount: 3,
};

export function formatTime(totalSeconds: number) {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (clamped % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function createMatchEvent(matchId: string, type: Match["events"][number]["type"], label: string) {
  return {
    id: crypto.randomUUID(),
    matchId,
    at: new Date().toISOString(),
    type,
    label,
  };
}

export function createEmptyMatch(input: {
  matchNo: string;
  groupName: string;
  piste: string;
  redName: string;
  redClub: string;
  blueName: string;
  blueClub: string;
  ruleSet: RuleSet;
}): Match {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    matchNo: input.matchNo,
    groupName: input.groupName,
    piste: input.piste,
    red: { name: input.redName, club: input.redClub },
    blue: { name: input.blueName, club: input.blueClub },
    redScore: 0,
    blueScore: 0,
    redPenalties: 0,
    bluePenalties: 0,
    status: "pending",
    winner: null,
    endReason: null,
    remainingSeconds: input.ruleSet.durationSeconds,
    isOvertime: false,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function resolveWinner(redScore: number, blueScore: number, allowDraw: boolean): Winner {
  if (redScore > blueScore) return "red";
  if (blueScore > redScore) return "blue";
  return allowDraw ? "draw" : null;
}

export function getWinnerLabel(winner: Winner, match: Match) {
  if (winner === "red") return match.red.name || "红方";
  if (winner === "blue") return match.blue.name || "蓝方";
  if (winner === "draw") return "平局";
  return "未定";
}

export function getEndReasonLabel(reason: MatchEndReason) {
  const map: Record<Exclude<MatchEndReason, null>, string> = {
    target_score: "达到目标分",
    time_up: "时间结束",
    manual: "手动结束",
    forfeit: "处罚判负",
    draw: "平局结束",
  };
  return reason ? map[reason] : "未结束";
}

export function evaluateAfterScore(match: Match, ruleSet: RuleSet): Match {
  if (match.status === "finished") return match;
  const reachedTarget = match.redScore >= ruleSet.targetScore || match.blueScore >= ruleSet.targetScore;
  if (!reachedTarget) return match;

  const winner = resolveWinner(match.redScore, match.blueScore, ruleSet.allowDraw);
  if (!winner) return match;
  return finishMatch(match, winner, winner === "draw" ? "draw" : "target_score");
}

export function evaluateTimeUp(match: Match, ruleSet: RuleSet): Match {
  if (match.status === "finished" || match.remainingSeconds > 0) return match;

  const winner = resolveWinner(match.redScore, match.blueScore, ruleSet.allowDraw);
  if (winner) return finishMatch(match, winner, winner === "draw" ? "draw" : "time_up");

  // 平分且不允许平局时，加时是唯一能继续产生结果的规则分支。
  if (ruleSet.enableOvertime && !match.isOvertime) {
    return touch({
      ...match,
      status: "paused",
      isOvertime: true,
      remainingSeconds: ruleSet.overtimeSeconds,
      events: [...match.events, createMatchEvent(match.id, "timer_paused", "常规时间结束，进入加时")],
    });
  }

  return touch({
    ...match,
    status: "paused",
    events: [...match.events, createMatchEvent(match.id, "timer_paused", "时间结束，比分相同，需要手动判定")],
  });
}

export function finishMatch(match: Match, winner: Winner, reason: MatchEndReason): Match {
  return touch({
    ...match,
    status: "finished",
    winner,
    endReason: reason,
    events: [...match.events, createMatchEvent(match.id, "match_finished", `比赛结束：${getEndReasonLabel(reason)}`)],
  });
}

export function touch(match: Match): Match {
  return {
    ...match,
    updatedAt: new Date().toISOString(),
  };
}
