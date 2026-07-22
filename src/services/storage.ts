import { defaultRuleSet, normalizeMatch, normalizeRuleSet } from "../domain/rules";
import { inferMatchRuleProfile } from "../domain/matchRules";
import type { DisciplinePointConfig, EventPointConfig, RankingRuleConfig, RuleSet, TournamentEvent, TournamentState } from "../types";

const DB_NAME = "heima-record-db";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "tournament";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createInitialState(): TournamentState {
  return {
    name: "黑马兵击记录台",
    ruleSet: defaultRuleSet,
    event: createDefaultTournamentEvent(),
    matches: [],
    selectedMatchId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeState(state: TournamentState): TournamentState {
  const ruleSet = normalizeRuleSet(state.ruleSet);
  let event = normalizeTournamentEvent(state.event, ruleSet);
  const matches = (state.matches ?? []).map((match) => ({
    ...normalizeMatch(match, ruleSet),
    eventId: match.eventId ?? event.id,
    ruleProfile: match.ruleProfile ?? inferMatchRuleProfile(match.tournamentStage, match.groupName),
  }));
  const hasStartedMatch = matches.some((match) => Boolean(match.tournamentStage) && match.status !== "pending");
  if (hasStartedMatch && state.event?.rulesLockedAt === undefined) {
    const inferredStart = state.updatedAt ?? new Date().toISOString();
    event = { ...event, startedAt: inferredStart, rulesLockedAt: inferredStart };
  }
  return {
    ...state,
    ruleSet,
    event,
    matches,
    selectedMatchId: state.selectedMatchId ?? null,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

export function createDefaultTournamentEvent(ruleSet: RuleSet = defaultRuleSet): TournamentEvent {
  return {
    id: crypto.randomUUID(),
    players: [],
    stage: "setup",
    startedAt: null,
    rulesLockedAt: null,
    formatConfig: {
      format: "group_bracket",
      useSeeding: false,
      pisteCount: 1,
      groupAllocationMode: "group_size",
      groupSize: 6,
      groupCount: 2,
      groupAdvancers: 2,
      totalAdvancers: 4,
      avoidClubInGroups: true,
      swissRounds: 5,
      swissAdvancers: 8,
      avoidClubInSwiss: true,
      allowSwissBye: true,
      generateThirdPlaceMatch: true,
    },
    stageRuleConfig: createDefaultStageRuleConfig(ruleSet),
    eventPointConfig: createDefaultEventPointConfig(),
    rankingRules: createDefaultRankingRules(),
    disciplinePointConfig: createDefaultDisciplinePointConfig(ruleSet),
    groupNames: [],
    rankings: [],
    swissRounds: [],
    bracketNodes: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeTournamentEvent(event: Partial<TournamentEvent> | undefined, ruleSet: RuleSet): TournamentEvent {
  const fallback = createDefaultTournamentEvent(ruleSet);
  const legacyFormatConfig = event?.formatConfig as (Partial<TournamentEvent["formatConfig"]> & {
    swissGroupCount?: number;
    randomizeSwissFirstRound?: boolean;
  }) | undefined;
  let formatConfig = {
    ...fallback.formatConfig,
    ...event?.formatConfig,
    // 旧备份默认按种子编排；历史“首轮随机”打开时迁移为关闭全局种子。
    useSeeding: legacyFormatConfig
      ? legacyFormatConfig.useSeeding ?? !(legacyFormatConfig.randomizeSwissFirstRound ?? false)
      : fallback.formatConfig.useSeeding,
    pisteCount: normalizePisteCount(legacyFormatConfig?.pisteCount ?? legacyFormatConfig?.swissGroupCount),
    groupAllocationMode: legacyFormatConfig?.groupAllocationMode ?? "group_size",
    groupCount: Math.max(1, Math.trunc(legacyFormatConfig?.groupCount || fallback.formatConfig.groupCount)),
  };
  const activePlayerCount = (event?.players ?? []).filter((player) => player.status === "active").length;
  if (formatConfig.format === "group_bracket" && activePlayerCount > 0) {
    const groupCount = formatConfig.groupAllocationMode === "group_count"
      ? Math.max(1, Math.min(activePlayerCount, formatConfig.groupCount))
      : Math.max(1, Math.ceil(activePlayerCount / Math.max(2, formatConfig.groupSize)));
    const smallestGroupSize = Math.floor(activePlayerCount / groupCount);
    const groupAdvancers = Math.max(1, Math.min(formatConfig.groupAdvancers, smallestGroupSize));
    formatConfig = {
      ...formatConfig,
      groupAdvancers,
      totalAdvancers: Math.min(activePlayerCount, Math.max(formatConfig.totalAdvancers, groupCount * groupAdvancers)),
    };
  }
  return {
    ...fallback,
    ...event,
    players: event?.players ?? [],
    formatConfig,
    stageRuleConfig: normalizeStageRuleConfig(event?.stageRuleConfig, ruleSet),
    eventPointConfig: {
      ...fallback.eventPointConfig,
      ...event?.eventPointConfig,
    },
    rankingRules: normalizeRankingRules(event?.rankingRules),
    disciplinePointConfig: {
      ...fallback.disciplinePointConfig,
      ...event?.disciplinePointConfig,
      warningDeductions: {
        ...fallback.disciplinePointConfig.warningDeductions,
        ...event?.disciplinePointConfig?.warningDeductions,
      },
    },
    groupNames: event?.groupNames ?? [],
    rankings: event?.rankings ?? [],
    swissRounds: event?.swissRounds ?? [],
    bracketNodes: event?.bracketNodes ?? [],
    updatedAt: event?.updatedAt ?? new Date().toISOString(),
  };
}

export function createDefaultStageRuleConfig(ruleSet: RuleSet) {
  const base = { durationSeconds: ruleSet.durationSeconds, targetScore: ruleSet.targetScore };
  return {
    preliminary: { ...base },
    elimination: { ...base },
    finals: { ...base },
  };
}

function normalizeStageRuleConfig(config: Partial<TournamentEvent["stageRuleConfig"]> | undefined, ruleSet: RuleSet) {
  const fallback = createDefaultStageRuleConfig(ruleSet);
  return {
    preliminary: normalizeStageRule(config?.preliminary, fallback.preliminary),
    elimination: normalizeStageRule(config?.elimination, fallback.elimination),
    finals: normalizeStageRule(config?.finals, fallback.finals),
  };
}

function normalizeStageRule(value: Partial<TournamentEvent["stageRuleConfig"]["preliminary"]> | undefined, fallback: TournamentEvent["stageRuleConfig"]["preliminary"]) {
  return {
    durationSeconds: Math.max(1, Math.trunc(value?.durationSeconds || fallback.durationSeconds)),
    targetScore: Math.max(1, Math.trunc(value?.targetScore || fallback.targetScore)),
  };
}

function normalizePisteCount(value?: number) {
  return Math.min(26, Math.max(1, Math.trunc(value || 1)));
}

export function createDefaultEventPointConfig(): EventPointConfig {
  return {
    win: 3,
    draw: 1,
    loss: 0,
    doubleLoss: 0,
  };
}

export function createDefaultRankingRules(): RankingRuleConfig[] {
  return [
    { key: "eventPoints", label: "赛事积分", enabled: true, priority: 1 },
    { key: "realWins", label: "真实胜场", enabled: true, priority: 2 },
    { key: "scoreDiff", label: "净胜分", enabled: true, priority: 3 },
    { key: "disciplinePenalty", label: "纪律扣分", enabled: true, priority: 4 },
    { key: "headToHead", label: "相互胜负", enabled: false, priority: 5 },
    { key: "playoff", label: "附加赛", enabled: true, priority: 99 },
  ];
}

function createDefaultDisciplinePointConfig(ruleSet: RuleSet): DisciplinePointConfig {
  return {
    applyToEventPoints: true,
    warningDeductions: Object.fromEntries(ruleSet.warningLevels.map((warning) => [warning.id, Math.abs(warning.scoreDelta)])),
  };
}

function normalizeRankingRules(rules?: RankingRuleConfig[]) {
  const existingRules = new Map((rules ?? []).map((rule) => [rule.key, rule]));
  return createDefaultRankingRules()
    .map((rule) => ({ ...rule, ...existingRules.get(rule.key), label: rule.label }))
    .sort((a, b) => a.priority - b.priority);
}

export async function loadState(): Promise<TournamentState> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(normalizeState((request.result as TournamentState | undefined) ?? createInitialState()));
    request.onerror = () => reject(request.error);
  });
}

export async function saveState(state: TournamentState): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ ...state, updatedAt: new Date().toISOString() }, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
