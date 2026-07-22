import type { Match, TournamentState } from "../types";

export type ArrangementMatchPatch = Pick<Match, "matchNo" | "groupName" | "piste">;

export function clearTournamentArrangement(state: TournamentState): TournamentState {
  const remainingMatches = state.matches.filter((match) => !match.tournamentStage);
  const remainingIds = new Set(remainingMatches.map((match) => match.id));
  return touchState({
    ...state,
    event: {
      ...state.event,
      players: state.event.players.map((player) => ({ ...player, groupName: "" })),
      stage: "setup",
      groupNames: [],
      rankings: [],
      swissRounds: [],
      bracketNodes: [],
      updatedAt: new Date().toISOString(),
    },
    matches: remainingMatches,
    selectedMatchId: state.selectedMatchId && remainingIds.has(state.selectedMatchId)
      ? state.selectedMatchId
      : remainingMatches[0]?.id ?? null,
  });
}

export function replaceMatchesWithImported(state: TournamentState, matches: Match[]): TournamentState {
  const cleared = clearTournamentArrangement(state);
  return touchState({
    ...cleared,
    matches,
    selectedMatchId: matches[0]?.id ?? null,
  });
}

export function removeImportedMatches(state: TournamentState, matchIds: string[]): TournamentState {
  const removableIds = new Set(matchIds);
  const matches = state.matches.filter((match) => match.tournamentStage || !removableIds.has(match.id));
  const remainingIds = new Set(matches.map((match) => match.id));
  return touchState({
    ...state,
    matches,
    selectedMatchId: state.selectedMatchId && remainingIds.has(state.selectedMatchId)
      ? state.selectedMatchId
      : matches[0]?.id ?? null,
  });
}

export function updateArrangementMatch(
  state: TournamentState,
  matchId: string,
  patch: Partial<ArrangementMatchPatch>
): TournamentState {
  const allowedPatch: Partial<ArrangementMatchPatch> = {
    ...(patch.matchNo !== undefined ? { matchNo: patch.matchNo } : {}),
    ...(patch.groupName !== undefined ? { groupName: patch.groupName } : {}),
    ...(patch.piste !== undefined ? { piste: patch.piste } : {}),
  };
  let changed = false;
  const matches = state.matches.map((match) => {
    if (match.id !== matchId || !match.tournamentStage || match.status !== "pending") return match;
    changed = true;
    return { ...match, ...allowedPatch, updatedAt: new Date().toISOString() };
  });
  return changed ? touchState({ ...state, matches }) : state;
}

export function resetTournamentState(state: TournamentState, initialState: TournamentState): TournamentState {
  return touchState({
    ...initialState,
    ruleSet: state.ruleSet,
    event: {
      ...initialState.event,
      stageRuleConfig: state.event.stageRuleConfig,
    },
  });
}

export function getTournamentProgress(state: TournamentState) {
  const total = state.matches.length;
  const completed = state.matches.filter((match) => match.status === "finished").length;
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function touchState(state: TournamentState): TournamentState {
  return { ...state, updatedAt: new Date().toISOString() };
}
