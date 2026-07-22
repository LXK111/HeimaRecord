import type { Match, TournamentState } from "../types";

export function startTournament(state: TournamentState, at = new Date().toISOString()): TournamentState {
  if (state.event.rulesLockedAt) return state;
  return {
    ...state,
    event: {
      ...state.event,
      startedAt: state.event.startedAt ?? at,
      rulesLockedAt: at,
      updatedAt: at,
    },
    updatedAt: at,
  };
}

export function getNextMatchOnSamePiste(matches: Match[], currentMatch: Match): Match | null {
  if (currentMatch.status !== "finished") return null;
  const ordered = matches
    .filter((match) => (
      match.piste === currentMatch.piste &&
      match.status === "pending" &&
      (!currentMatch.eventId || match.eventId === currentMatch.eventId)
    ))
    .sort(compareMatchSchedule);
  return ordered[0] ?? null;
}

function compareMatchSchedule(a: Match, b: Match) {
  const numberA = Number(a.matchNo);
  const numberB = Number(b.matchNo);
  if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) return numberA - numberB;
  return a.matchNo.localeCompare(b.matchNo, "zh-CN", { numeric: true });
}
