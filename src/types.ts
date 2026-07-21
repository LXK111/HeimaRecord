export type MatchStatus = "pending" | "running" | "paused" | "finished";

export type Winner = "red" | "blue" | "draw" | null;

export type ScoringMode = "target_score" | "round_limit";

export type MatchSide = "red" | "blue";

export type PenaltyStopResult = "opponent_win" | "self_win" | "draw" | "manual";

export type TournamentStageType = "group" | "playoff" | "bracket" | "third_place";

export type TournamentEventStage = "setup" | "group_ready" | "group_finished" | "bracket_ready" | "finished";

export type RankingRuleKey = "eventPoints" | "realWins" | "scoreDiff" | "disciplinePenalty" | "headToHead" | "playoff";

export type MatchEndReason =
  | "target_score"
  | "round_limit"
  | "time_up"
  | "manual"
  | "forfeit"
  | "draw"
  | null;

export interface Competitor {
  name: string;
  club: string;
}

export interface HitZone {
  id: string;
  label: string;
  score: number;
  enabled: boolean;
}

export interface WarningLevel {
  id: string;
  label: string;
  scoreDelta: number;
  isPenalty: boolean;
  isForfeit: boolean;
  stopsMatch: boolean;
  stopResult: PenaltyStopResult;
}

export interface WarningConversion {
  fromWarningId: string;
  count: number;
  toWarningId: string;
}

export interface RuleSet {
  scoringMode: ScoringMode;
  durationSeconds: number;
  targetScore: number;
  maxRounds: number;
  allowDoubleHit: boolean;
  allowNoHitRound: boolean;
  allowDraw: boolean;
  enableOvertime: boolean;
  overtimeSeconds: number;
  penaltyDeduction: number;
  maxPenaltyCount: number;
  hitZones: HitZone[];
  warningLevels: WarningLevel[];
  warningConversions: WarningConversion[];
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
    | "hit_recorded"
    | "warning_added"
    | "round_recorded"
    | "appeal_recorded"
    | "match_reset"
    | "undo_applied"
    | "post_match_adjustment"
    | "match_finished"
    | "manual_note";
  label: string;
}

export interface RoundRecord {
  id: string;
  roundNumber: number;
  result: "red" | "blue" | "double" | "none";
  redScoreDelta: number;
  blueScoreDelta: number;
  at: string;
}

export interface AdjudicationInput {
  redScoreDelta: number;
  blueScoreDelta: number;
  redWarningId: string;
  blueWarningId: string;
}

export interface MatchSnapshot {
  redScore: number;
  blueScore: number;
  redPenalties: number;
  bluePenalties: number;
  redWarnings: Record<string, number>;
  blueWarnings: Record<string, number>;
  status: MatchStatus;
  winner: Winner;
  endReason: MatchEndReason;
  remainingSeconds: number;
  isOvertime: boolean;
  events: MatchEvent[];
  currentRound: number;
  roundRecords: RoundRecord[];
}

export interface Match {
  id: string;
  matchNo: string;
  groupName: string;
  piste: string;
  tournamentStage?: TournamentStageType;
  tournamentRound?: number;
  bracketNodeId?: string;
  redPlayerId?: string;
  bluePlayerId?: string;
  red: Competitor;
  blue: Competitor;
  redScore: number;
  blueScore: number;
  redPenalties: number;
  bluePenalties: number;
  redWarnings: Record<string, number>;
  blueWarnings: Record<string, number>;
  status: MatchStatus;
  winner: Winner;
  endReason: MatchEndReason;
  remainingSeconds: number;
  isOvertime: boolean;
  currentRound: number;
  roundRecords: RoundRecord[];
  events: MatchEvent[];
  history: MatchSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface TournamentPlayer {
  id: string;
  name: string;
  club: string;
  seed: number | null;
  status: "active" | "withdrawn";
  groupName: string;
}

export interface TournamentFormatConfig {
  groupSize: number;
  groupAdvancers: number;
  totalAdvancers: number;
  generateThirdPlaceMatch: boolean;
}

export interface EventPointConfig {
  win: number;
  draw: number;
  loss: number;
  doubleLoss: number;
}

export interface RankingRuleConfig {
  key: RankingRuleKey;
  label: string;
  enabled: boolean;
  priority: number;
}

export interface DisciplinePointConfig {
  applyToEventPoints: boolean;
  warningDeductions: Record<string, number>;
}

export interface TournamentRanking {
  rank: number;
  playerId: string;
  name: string;
  club: string;
  groupName: string;
  eventPoints: number;
  realWins: number;
  draws: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  disciplinePenalty: number;
  advanced: boolean;
  needsPlayoff: boolean;
}

export interface BracketNode {
  id: string;
  roundNo: number;
  label: string;
  matchId: string | null;
  redPlayerId: string | null;
  bluePlayerId: string | null;
  winnerPlayerId: string | null;
  loserPlayerId: string | null;
  seedOrder: number;
  stage: TournamentStageType;
  status: "bye" | "ready" | "finished";
}

export interface TournamentEvent {
  players: TournamentPlayer[];
  stage: TournamentEventStage;
  formatConfig: TournamentFormatConfig;
  eventPointConfig: EventPointConfig;
  rankingRules: RankingRuleConfig[];
  disciplinePointConfig: DisciplinePointConfig;
  groupNames: string[];
  rankings: TournamentRanking[];
  bracketNodes: BracketNode[];
  updatedAt: string;
}

export interface TournamentState {
  name: string;
  ruleSet: RuleSet;
  event: TournamentEvent;
  matches: Match[];
  selectedMatchId: string | null;
  updatedAt: string;
}
