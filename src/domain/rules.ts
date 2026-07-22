import type { AdjudicationInput, Match, MatchEndReason, MatchSide, MatchSnapshot, RoundRecord, RuleSet, WarningLevel, Winner } from "../types";

export const defaultRuleSet: RuleSet = {
  scoringMode: "target_score",
  durationSeconds: 180,
  targetScore: 10,
  maxRounds: 10,
  allowDoubleHit: true,
  allowNoHitRound: true,
  allowDraw: false,
  enableOvertime: true,
  overtimeSeconds: 60,
  penaltyDeduction: 1,
  maxPenaltyCount: 3,
  hitZones: [
    { id: "head", label: "头部", score: 3, enabled: true },
    { id: "torso", label: "躯干", score: 2, enabled: true },
    { id: "arm", label: "手臂", score: 1, enabled: true },
    { id: "leg", label: "腿部", score: 1, enabled: true },
  ],
  warningLevels: [
    { id: "verbal", label: "口头警告", scoreDelta: 0, isPenalty: false, isForfeit: false, stopsMatch: false, stopResult: "opponent_win" },
    { id: "yellow", label: "黄牌", scoreDelta: 0, isPenalty: false, isForfeit: false, stopsMatch: false, stopResult: "opponent_win" },
    { id: "red", label: "红牌", scoreDelta: -1, isPenalty: true, isForfeit: false, stopsMatch: false, stopResult: "opponent_win" },
    { id: "black", label: "黑牌", scoreDelta: 0, isPenalty: true, isForfeit: true, stopsMatch: true, stopResult: "opponent_win" },
  ],
  warningConversions: [
    { fromWarningId: "yellow", count: 2, toWarningId: "red" },
    { fromWarningId: "red", count: 3, toWarningId: "black" },
  ],
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

export function normalizeRuleSet(ruleSet?: Partial<RuleSet>): RuleSet {
  const warningLevels = ruleSet?.warningLevels?.length ? ruleSet.warningLevels : defaultRuleSet.warningLevels;
  return {
    ...defaultRuleSet,
    ...ruleSet,
    hitZones: ruleSet?.hitZones?.length ? ruleSet.hitZones : defaultRuleSet.hitZones,
    warningLevels: warningLevels.map(normalizeWarningLevel),
    warningConversions: ruleSet?.warningConversions?.length ? ruleSet.warningConversions : defaultRuleSet.warningConversions,
  };
}

function normalizeWarningLevel(warning: WarningLevel): WarningLevel {
  return {
    ...warning,
    stopsMatch: warning.stopsMatch ?? warning.isForfeit ?? false,
    stopResult: warning.stopResult ?? "opponent_win",
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
    redWarnings: {},
    blueWarnings: {},
    currentRound: 1,
    roundRecords: [],
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeMatch(match: Match, ruleSet: RuleSet): Match {
  return {
    ...match,
    remainingSeconds: typeof match.remainingSeconds === "number" ? match.remainingSeconds : ruleSet.durationSeconds,
    redWarnings: match.redWarnings ?? {},
    blueWarnings: match.blueWarnings ?? {},
    currentRound: match.currentRound ?? 1,
    roundRecords: match.roundRecords ?? [],
    history: match.history ?? [],
    events: match.events ?? [],
  };
}

export function takeSnapshot(match: Match): MatchSnapshot {
  return {
    redScore: match.redScore,
    blueScore: match.blueScore,
    redPenalties: match.redPenalties,
    bluePenalties: match.bluePenalties,
    redWarnings: { ...match.redWarnings },
    blueWarnings: { ...match.blueWarnings },
    status: match.status,
    winner: match.winner,
    endReason: match.endReason,
    remainingSeconds: match.remainingSeconds,
    isOvertime: match.isOvertime,
    events: match.events,
    currentRound: match.currentRound,
    roundRecords: match.roundRecords,
  };
}

export function withHistory(match: Match): Match {
  return {
    ...match,
    history: [...(match.history ?? []), takeSnapshot(match)].slice(-50),
  };
}

export function restorePreviousSnapshot(match: Match): Match {
  const history = match.history ?? [];
  const previous = history[history.length - 1];
  if (!previous) return match;

  return touch({
    ...match,
    ...previous,
    redWarnings: { ...previous.redWarnings },
    blueWarnings: { ...previous.blueWarnings },
    remainingSeconds: match.remainingSeconds,
    isOvertime: match.isOvertime,
    history: history.slice(0, -1),
    events: [...previous.events, createMatchEvent(match.id, "undo_applied", `撤销上一步操作，计时保留为${formatTime(match.remainingSeconds)}`)],
  });
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
    round_limit: "回合数打满",
    time_up: "时间结束",
    manual: "手动结束",
    forfeit: "处罚判负",
    draw: "平局结束",
  };
  return reason ? map[reason] : "未结束";
}

export function evaluateAfterScore(match: Match, ruleSet: RuleSet): Match {
  if (ruleSet.scoringMode === "round_limit") return match;
  if (match.status === "finished") return match;
  const reachedTarget = match.redScore >= ruleSet.targetScore || match.blueScore >= ruleSet.targetScore;
  if (!reachedTarget) return match;

  const winner = resolveWinner(match.redScore, match.blueScore, ruleSet.allowDraw);
  if (!winner) return match;
  return finishMatch(match, winner, winner === "draw" ? "draw" : "target_score", false);
}

export function recordRoundResult(match: Match, result: RoundRecord["result"], ruleSet: RuleSet): Match {
  if (match.status === "finished" || ruleSet.scoringMode !== "round_limit") return match;
  if (result === "double" && !ruleSet.allowDoubleHit) return match;
  if (result === "none" && !ruleSet.allowNoHitRound) return match;
  if (!match.isOvertime && match.currentRound > ruleSet.maxRounds) return match;

  const redScoreDelta = result === "red" || result === "double" ? 1 : 0;
  const blueScoreDelta = result === "blue" || result === "double" ? 1 : 0;
  const labelMap: Record<RoundRecord["result"], string> = {
    red: "红方得分",
    blue: "蓝方得分",
    double: "双方得分",
    none: "无效回合",
  };
  const roundRecord: RoundRecord = {
    id: crypto.randomUUID(),
    roundNumber: match.currentRound,
    result,
    redScoreDelta,
    blueScoreDelta,
    at: new Date().toISOString(),
  };
  const next = touch({
    ...withHistory(match),
    redScore: match.redScore + redScoreDelta,
    blueScore: match.blueScore + blueScoreDelta,
    currentRound: match.currentRound + 1,
    roundRecords: [...match.roundRecords, roundRecord],
    events: [...match.events, createMatchEvent(match.id, "round_recorded", `第${match.currentRound}回合：${labelMap[result]}`)],
  });

  if (!next.isOvertime && next.roundRecords.length >= ruleSet.maxRounds) {
    const winner = resolveWinner(next.redScore, next.blueScore, ruleSet.allowDraw);
    if (winner) return finishMatch(next, winner, winner === "draw" ? "draw" : "round_limit", false);
    if (ruleSet.enableOvertime) return enterOvertime(next, ruleSet, "回合数打满，比分相同，进入加时");
    return touch({
      ...next,
      status: "paused",
      events: [...next.events, createMatchEvent(match.id, "timer_paused", "回合数打满，比分相同，需要手动判定")],
    });
  }

  return next;
}

export function recordAdjudication(match: Match, input: AdjudicationInput, ruleSet: RuleSet): Match {
  if (match.status === "finished") return match;
  if (ruleSet.scoringMode === "round_limit" && !match.isOvertime && match.currentRound > ruleSet.maxRounds) return match;

  const redScoreDelta = Math.max(0, input.redScoreDelta);
  const blueScoreDelta = Math.max(0, input.blueScoreDelta);
  const shouldRecordRound = ruleSet.scoringMode === "round_limit";
  const result = getRoundResult(redScoreDelta, blueScoreDelta);
  if (shouldRecordRound && result === "double" && !ruleSet.allowDoubleHit) return match;
  if (shouldRecordRound && result === "none" && !ruleSet.allowNoHitRound) return match;

  let next = touch({
    ...withHistory(match),
    redScore: match.redScore + redScoreDelta,
    blueScore: match.blueScore + blueScoreDelta,
    events: [
      ...match.events,
      createMatchEvent(match.id, "score_changed", `综合判定：红方 +${redScoreDelta}，蓝方 +${blueScoreDelta}`),
    ],
  });

  if (shouldRecordRound) {
    const roundRecord: RoundRecord = {
      id: crypto.randomUUID(),
      roundNumber: match.currentRound,
      result,
      redScoreDelta,
      blueScoreDelta,
      at: new Date().toISOString(),
    };
    next = touch({
      ...next,
      currentRound: match.currentRound + 1,
      roundRecords: [...match.roundRecords, roundRecord],
      events: [...next.events, createMatchEvent(match.id, "round_recorded", `第${match.currentRound}回合综合判定已记录`)],
    });
  }

  next = applyWarningCounts(next, "red", input.redWarnings, ruleSet);
  next = applyWarningCounts(next, "blue", input.blueWarnings, ruleSet);
  if (next.status === "finished") return next;

  if (shouldRecordRound && !next.isOvertime && next.roundRecords.length >= ruleSet.maxRounds) {
    const winner = resolveWinner(next.redScore, next.blueScore, ruleSet.allowDraw);
    if (winner) return finishMatch(next, winner, winner === "draw" ? "draw" : "round_limit", false);
    if (ruleSet.enableOvertime) return enterOvertime(next, ruleSet, "回合数打满，比分相同，进入加时");
    return touch({
      ...next,
      status: "paused",
      events: [...next.events, createMatchEvent(match.id, "timer_paused", "回合数打满，比分相同，需要手动判定")],
    });
  }

  return evaluateAfterScore(next, ruleSet);
}

function getRoundResult(redScoreDelta: number, blueScoreDelta: number): RoundRecord["result"] {
  if (redScoreDelta > 0 && blueScoreDelta > 0) return "double";
  if (redScoreDelta > 0) return "red";
  if (blueScoreDelta > 0) return "blue";
  return "none";
}

export function recordHit(match: Match, side: "red" | "blue", zoneId: string, ruleSet: RuleSet): Match {
  if (match.status === "finished") return match;
  const zone = ruleSet.hitZones.find((item) => item.id === zoneId && item.enabled);
  if (!zone) return match;

  const sideLabel = side === "red" ? "红方" : "蓝方";
  const scored = touch({
    ...withHistory(match),
    redScore: side === "red" ? match.redScore + zone.score : match.redScore,
    blueScore: side === "blue" ? match.blueScore + zone.score : match.blueScore,
    events: [...match.events, createMatchEvent(match.id, "hit_recorded", `${sideLabel}命中${zone.label} +${zone.score}`)],
  });
  return evaluateAfterScore(scored, ruleSet);
}

export function applyWarning(match: Match, side: "red" | "blue", warningId: string, ruleSet: RuleSet): Match {
  if (match.status === "finished") return match;
  const warning = ruleSet.warningLevels.find((item) => item.id === warningId);
  if (!warning) return match;
  return applyWarningLevel(withHistory(match), side, warning, ruleSet, true);
}

function applyWarningCounts(match: Match, side: MatchSide, warnings: Record<string, number>, ruleSet: RuleSet) {
  let next = match;
  for (const warning of ruleSet.warningLevels) {
    const count = Math.max(0, Math.trunc(warnings[warning.id] ?? 0));
    for (let index = 0; index < count && next.status !== "finished"; index += 1) {
      next = applyWarningLevel(next, side, warning, ruleSet, true);
    }
  }
  return next;
}

function applyWarningLevel(
  match: Match,
  side: "red" | "blue",
  warning: WarningLevel,
  ruleSet: RuleSet,
  allowConversion: boolean,
  visitedConversions = new Set<string>()
): Match {
  const sideLabel = side === "red" ? "红方" : "蓝方";
  const warningKey = side === "red" ? "redWarnings" : "blueWarnings";
  const penaltyKey = side === "red" ? "redPenalties" : "bluePenalties";
  const scoreKey = side === "red" ? "redScore" : "blueScore";
  const nextWarnings = { ...match[warningKey], [warning.id]: (match[warningKey][warning.id] ?? 0) + 1 };
  const nextPenaltyCount = warning.isPenalty ? match[penaltyKey] + 1 : match[penaltyKey];
  const nextScore = Math.max(0, match[scoreKey] + warning.scoreDelta);

  let next = touch({
    ...match,
    [warningKey]: nextWarnings,
    [penaltyKey]: nextPenaltyCount,
    [scoreKey]: nextScore,
    events: [...match.events, createMatchEvent(match.id, "warning_added", `${sideLabel}${warning.label}${warning.scoreDelta ? ` ${warning.scoreDelta}分` : ""}`)],
  });

  if (warning.stopsMatch || warning.isForfeit) {
    return stopMatchByPenalty(next, side, warning);
  }

  // 转换会消费来源警告；已产生的扣分和处罚属于历史效果，不随牌面转换回滚。
  if (allowConversion) {
    const conversion = ruleSet.warningConversions.find((item) => item.fromWarningId === warning.id && item.count > 0 && (nextWarnings[warning.id] ?? 0) >= item.count);
    const converted = conversion ? ruleSet.warningLevels.find((item) => item.id === conversion.toWarningId) : null;
    const conversionKey = conversion ? `${conversion.fromWarningId}->${conversion.toWarningId}` : "";
    if (conversion && converted && !visitedConversions.has(conversionKey)) {
      const remainingSourceCount = (next[warningKey][warning.id] ?? 0) - conversion.count;
      const convertedWarnings = { ...next[warningKey], [warning.id]: remainingSourceCount };
      if (remainingSourceCount === 0) delete convertedWarnings[warning.id];
      next = applyWarningLevel(
        {
          ...next,
          [warningKey]: convertedWarnings,
          events: [...next.events, createMatchEvent(match.id, "warning_added", `${sideLabel}${warning.label}消费${conversion.count}次，转换为${converted.label}`)],
        },
        side,
        converted,
        ruleSet,
        true,
        new Set([...visitedConversions, conversionKey])
      );
    }
  }

  if (next.status === "finished") return next;
  if (ruleSet.maxPenaltyCount > 0 && next[penaltyKey] >= ruleSet.maxPenaltyCount) {
    return finishMatch(next, side === "red" ? "blue" : "red", "forfeit", false);
  }

  return next;
}

function stopMatchByPenalty(match: Match, side: MatchSide, warning: WarningLevel): Match {
  const winner = resolvePenaltyStopWinner(side, warning);
  if (!winner) {
    return touch({
      ...match,
      status: "paused",
      endReason: "forfeit",
      events: [...match.events, createMatchEvent(match.id, "timer_paused", `${warning.label}触发中止，等待手动判定`)],
    });
  }
  return finishMatch(match, winner, winner === "draw" ? "draw" : "forfeit", false);
}

function resolvePenaltyStopWinner(side: MatchSide, warning: WarningLevel): Winner {
  if (warning.stopResult === "draw") return "draw";
  if (warning.stopResult === "manual") return null;
  if (warning.stopResult === "self_win") return side;
  return side === "red" ? "blue" : "red";
}

export function recordAppeal(match: Match): Match {
  return touch({
    ...withHistory(match),
    events: [
      ...match.events,
      createMatchEvent(match.id, "appeal_recorded", `申诉记录：剩余${formatTime(match.remainingSeconds)}，红 ${match.redScore} : 蓝 ${match.blueScore}`),
    ],
  });
}

export function resetMatch(match: Match, ruleSet: RuleSet): Match {
  return touch({
    ...withHistory(match),
    redScore: 0,
    blueScore: 0,
    redPenalties: 0,
    bluePenalties: 0,
    redWarnings: {},
    blueWarnings: {},
    status: "pending",
    winner: null,
    endReason: null,
    remainingSeconds: ruleSet.durationSeconds,
    isOvertime: false,
    currentRound: 1,
    roundRecords: [],
    events: [...match.events, createMatchEvent(match.id, "match_reset", "比赛已重置")],
  });
}

export function adjustFinishedScore(match: Match, side: "red" | "blue", delta: number, reason: string, ruleSet: RuleSet): Match {
  if (match.status !== "finished") return match;
  const sideLabel = side === "red" ? "红方" : "蓝方";
  const next = touch({
    ...withHistory(match),
    redScore: side === "red" ? Math.max(0, match.redScore + delta) : match.redScore,
    blueScore: side === "blue" ? Math.max(0, match.blueScore + delta) : match.blueScore,
    events: [...match.events, createMatchEvent(match.id, "post_match_adjustment", `赛后修正：${sideLabel}${delta > 0 ? "+" : ""}${delta}，原因：${reason || "未填写"}`)],
  });
  return {
    ...next,
    winner: resolveWinner(next.redScore, next.blueScore, ruleSet.allowDraw),
    endReason: next.endReason ?? "manual",
  };
}

export function adjustFinishedWinner(match: Match, winner: Winner, reason: string): Match {
  if (match.status !== "finished") return match;
  return touch({
    ...withHistory(match),
    winner,
    endReason: winner === "draw" ? "draw" : "manual",
    events: [...match.events, createMatchEvent(match.id, "post_match_adjustment", `赛后修正胜方：${winner === "red" ? "红方" : winner === "blue" ? "蓝方" : "平局"}，原因：${reason || "未填写"}`)],
  });
}

export function evaluateTimeUp(match: Match, ruleSet: RuleSet): Match {
  if (match.status === "finished" || match.remainingSeconds > 0) return match;

  const winner = resolveWinner(match.redScore, match.blueScore, ruleSet.allowDraw);
  if (winner) return finishMatch(match, winner, winner === "draw" ? "draw" : "time_up");

  if (ruleSet.enableOvertime && !match.isOvertime) {
    return enterOvertime(match, ruleSet, "常规时间结束，比分相同，进入加时");
  }

  if (ruleSet.allowDraw) {
    return finishMatch(match, "draw", "draw");
  }

  return touch({
    ...match,
    status: "paused",
    events: [...match.events, createMatchEvent(match.id, "timer_paused", "时间结束，比分相同，需要手动判定")],
  });
}

function enterOvertime(match: Match, ruleSet: RuleSet, label: string): Match {
  return touch({
    ...match,
    status: "paused",
    isOvertime: true,
    remainingSeconds: Math.max(1, ruleSet.overtimeSeconds),
    events: [...match.events, createMatchEvent(match.id, "timer_paused", label)],
  });
}

export function finishMatch(match: Match, winner: Winner, reason: MatchEndReason, recordHistory = true): Match {
  const base = recordHistory ? withHistory(match) : match;
  return touch({
    ...base,
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
