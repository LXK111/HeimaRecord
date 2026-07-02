export type MatchStatus = "pending" | "running" | "paused" | "finished";

export type Winner = "red" | "blue" | "draw" | null;

export type MatchEndReason =
  | "target_score"
  | "time_up"
  | "manual"
  | "forfeit"
  | "draw"
  | null;

export interface Competitor {
  name: string;
  club: string;
}

export interface RuleSet {
  durationSeconds: number;
  targetScore: number;
  allowDraw: boolean;
  enableOvertime: boolean;
  overtimeSeconds: number;
  penaltyDeduction: number;
  maxPenaltyCount: number;
}

export interface MatchEvent {
  id: string;
  matchId: string;
  at: string;
  type:
    | "match_created"
    | "timer_started"
    | "timer_paused"
    | "timer_reset"
    | "score_changed"
    | "penalty_added"
    | "match_finished"
    | "manual_note";
  label: string;
}

export interface Match {
  id: string;
  matchNo: string;
  groupName: string;
  piste: string;
  red: Competitor;
  blue: Competitor;
  redScore: number;
  blueScore: number;
  redPenalties: number;
  bluePenalties: number;
  status: MatchStatus;
  winner: Winner;
  endReason: MatchEndReason;
  remainingSeconds: number;
  isOvertime: boolean;
  events: MatchEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface TournamentState {
  name: string;
  ruleSet: RuleSet;
  matches: Match[];
  selectedMatchId: string | null;
  updatedAt: string;
}
