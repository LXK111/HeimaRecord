import { defaultRuleSet, normalizeMatch, normalizeRuleSet } from "../domain/rules";
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
  return {
    ...state,
    ruleSet,
    event: normalizeTournamentEvent(state.event),
    matches: (state.matches ?? []).map((match) => normalizeMatch(match, ruleSet)),
    selectedMatchId: state.selectedMatchId ?? null,
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

export function createDefaultTournamentEvent(): TournamentEvent {
  const ruleSet = defaultRuleSet;
  return {
    players: [],
    stage: "setup",
    formatConfig: {
      format: "group_bracket",
      groupSize: 6,
      groupAdvancers: 2,
      totalAdvancers: 4,
      swissRounds: 5,
      swissAdvancers: 8,
      swissGroupCount: 1,
      avoidClubInSwiss: true,
      allowSwissBye: true,
      generateThirdPlaceMatch: true,
    },
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

function normalizeTournamentEvent(event?: Partial<TournamentEvent>): TournamentEvent {
  const fallback = createDefaultTournamentEvent();
  return {
    ...fallback,
    ...event,
    players: event?.players ?? [],
    formatConfig: {
      ...fallback.formatConfig,
      ...event?.formatConfig,
    },
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
