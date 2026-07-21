import { defaultRuleSet, normalizeMatch, normalizeRuleSet } from "../domain/rules";
import type { TournamentEvent, TournamentState } from "../types";

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
  return {
    players: [],
    stage: "setup",
    formatConfig: {
      groupSize: 6,
      groupAdvancers: 2,
      totalAdvancers: 4,
      generateThirdPlaceMatch: true,
    },
    groupNames: [],
    rankings: [],
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
    groupNames: event?.groupNames ?? [],
    rankings: event?.rankings ?? [],
    bracketNodes: event?.bracketNodes ?? [],
    updatedAt: event?.updatedAt ?? new Date().toISOString(),
  };
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
