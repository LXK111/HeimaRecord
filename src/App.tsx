import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FolderUp,
  Home,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldAlert,
  TimerReset,
  Trash2,
  Upload,
} from "lucide-react";
import { FileDropZone } from "./components/FileDropZone";
import { FileImportControl } from "./components/FileImportControl";
import {
  adjustFinishedScore,
  adjustFinishedWinner,
  applyWarning,
  createMatchEvent,
  evaluateTimeUp,
  finishMatch,
  formatTime,
  getEndReasonLabel,
  getWinnerLabel,
  recordAppeal,
  recordAdjudication,
  recordHit,
  recordRoundResult,
  resetMatch,
  restorePreviousSnapshot,
  touch,
} from "./domain/rules";
import {
  advanceBracket,
  calculateRankings,
  countGroupClubConflicts,
  generateDirectEliminationBracket,
  generateDoubleEliminationBracket,
  generateNextSwissRound,
  generateGroupStage,
  generateInitialBracket,
  generatePlayoffMatches,
  generateSwissFirstRound,
  getCurrentSwissRound,
  lockCurrentSwissRound,
  parsePlayersText,
  refreshTournamentRankings,
  syncTournamentEvent,
} from "./domain/tournament";
import {
  buildTournamentGroupingResults,
  hasGroupingResults,
} from "./domain/groupingResults";
import type { TournamentGroupingResults } from "./domain/groupingResults";
import {
  clearTournamentArrangement,
  getTournamentProgress,
  removeImportedMatches,
  replaceMatchesWithImported,
  resetTournamentState,
  updateArrangementMatch,
} from "./domain/tournamentState";
import { exportStateBackup, parseStateBackup } from "./services/backup";
import { exportArrangementToExcel, exportGroupingResultsToExcel, exportMatchesToCsv, exportMatchesToExcel, exportTournamentResultsToExcel } from "./services/exporter";
import { parseMatchFile } from "./services/importer";
import { parsePlayerFile } from "./services/playerImporter";
import { exportRuleSetToExcel, parseRuleFile } from "./services/ruleConfig";
import { createInitialState, loadState, saveState } from "./services/storage";
import type { AdjudicationInput, Match, RuleSet, TournamentState, Winner } from "./types";

type ViewKey = "home" | "players" | "tournament" | "matches" | "console" | "rankings" | "bracket" | "rules" | "results";

type MatchGroup = {
  name: string;
  matches: Match[];
};

function App() {
  const [state, setState] = useState<TournamentState>(createInitialState);
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [isLoading, setIsLoading] = useState(true);
  const [importMessage, setImportMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [ruleMessage, setRuleMessage] = useState("");
  const [playerMessage, setPlayerMessage] = useState("");
  const [tournamentMessage, setTournamentMessage] = useState("");
  const [playerText, setPlayerText] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjudication, setAdjudication] = useState<AdjudicationInput>({
    redScoreDelta: 0,
    blueScoreDelta: 0,
    redWarningId: "",
    blueWarningId: "",
  });
  const saveTimer = useRef<number | null>(null);

  const selectedMatch = useMemo(
    () => state.matches.find((match) => match.id === state.selectedMatchId) ?? state.matches[0] ?? null,
    [state.matches, state.selectedMatchId]
  );
  const groupedMatches = useMemo(() => groupMatchesByName(state.matches), [state.matches]);
  const arrangementMatches = useMemo(() => state.matches.filter((match) => match.tournamentStage), [state.matches]);
  const tournamentProgress = useMemo(() => getTournamentProgress(state), [state]);
  const syncedEvent = useMemo(() => syncTournamentEvent(state.event, state.matches), [state.event, state.matches]);
  const groupingResults = useMemo(() => buildTournamentGroupingResults(syncedEvent, state.matches), [syncedEvent, state.matches]);
  const liveRankings = useMemo(() => calculateRankings(syncedEvent, state.matches, state.ruleSet), [syncedEvent, state.matches, state.ruleSet]);
  const currentSwissRound = useMemo(() => getCurrentSwissRound(syncedEvent), [syncedEvent]);
  const isGroupFormat = state.event.formatConfig.format === "group_bracket";
  const isSwissFormat = state.event.formatConfig.format === "swiss_bracket";
  const isDirectBracketFormat = state.event.formatConfig.format === "direct_bracket";
  const isDoubleEliminationFormat = state.event.formatConfig.format === "double_elimination";
  const isNoPreliminaryFormat = isDirectBracketFormat || isDoubleEliminationFormat;

  useEffect(() => {
    loadState()
      .then((stored) => {
        setState(stored);
        setActiveView("home");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveState(state), 250);
  }, [state, isLoading]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      updateSelectedMatch((match) => {
        if (match.status !== "running") return match;
        const next = touch({ ...match, remainingSeconds: Math.max(0, match.remainingSeconds - 1) });
        return evaluateTimeUp(next, state.ruleSet);
      });
    }, 1000);
    return () => window.clearInterval(timer);
  });

  function patchState(patcher: (current: TournamentState) => TournamentState) {
    setState((current) => patcher(current));
  }

  function updateSelectedMatch(updater: (match: Match) => Match) {
    patchState((current) => {
      const targetId = current.selectedMatchId ?? current.matches[0]?.id;
      if (!targetId) return current;
      return {
        ...current,
        selectedMatchId: targetId,
        matches: current.matches.map((match) => (match.id === targetId ? updater(match) : match)),
      };
    });
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    if (state.matches.length > 0 && !window.confirm("导入场次将替换当前全部场次，并清空现有赛事编排。是否继续？")) return;
    setImportMessage("正在解析文件...");
    try {
      const matches = await parseMatchFile(file, state.ruleSet);
      if (matches.length === 0) {
        setImportMessage("没有识别到有效场次，请检查红方、蓝方字段。");
        return;
      }
      patchState((current) => replaceMatchesWithImported(current, matches));
      setActiveView("matches");
      setImportMessage(`已导入 ${matches.length} 场比赛。`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "导入失败，请检查文件格式。");
    }
  }

  async function handleBackupImport(file: File | null) {
    if (!file) return;
    setBackupMessage("正在恢复备份...");
    try {
      const backupState = await parseStateBackup(file);
      setState(backupState);
      setActiveView("home");
      setBackupMessage(`已恢复备份，包含 ${backupState.matches.length} 场比赛。`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "恢复失败，请检查 JSON 备份文件。");
    }
  }

  function resetTournament() {
    if (!window.confirm("将清空选手、场次、比分、排名和签表，但保留当前计分规则。是否重置赛事？")) return;
    patchState((current) => resetTournamentState(current, createInitialState()));
    setImportMessage("");
    setPlayerMessage("");
    setTournamentMessage("赛事已重置，当前计分规则已保留。");
    setActiveView("home");
  }

  function clearArrangement() {
    if (!window.confirm("将删除赛事编排生成的场次及其比赛结果，保留选手名单、赛制配置、规则和普通导入场次。是否继续？")) return;
    patchState(clearTournamentArrangement);
    setTournamentMessage("已清空赛事编排，可重新生成场次。");
  }

  function removeMatch(match: Match) {
    if (match.tournamentStage) return;
    if (!window.confirm(`确认移除第 ${match.matchNo} 场：${match.red.name} vs ${match.blue.name}？`)) return;
    patchState((current) => removeImportedMatches(current, [match.id]));
  }

  function removeMatchGroup(group: MatchGroup) {
    const importedMatches = group.matches.filter((match) => !match.tournamentStage);
    if (importedMatches.length !== group.matches.length || importedMatches.length === 0) return;
    if (!window.confirm(`确认移除“${group.name}”及其中 ${group.matches.length} 场比赛？`)) return;
    patchState((current) => removeImportedMatches(current, importedMatches.map((match) => match.id)));
  }

  function setMatchStatus(status: Match["status"]) {
    updateSelectedMatch((match) => {
      const eventType = status === "running" ? "timer_started" : "timer_paused";
      const label = status === "running" ? "计时开始" : "计时暂停";
      return touch({
        ...match,
        status,
        events: [...match.events, createMatchEvent(match.id, eventType, label)],
      });
    });
  }

  function resetTimer() {
    updateSelectedMatch((match) => {
      const duration = match.isOvertime ? state.ruleSet.overtimeSeconds : state.ruleSet.durationSeconds;
      return touch({
        ...match,
        status: "paused",
        remainingSeconds: duration,
        events: [...match.events, createMatchEvent(match.id, "timer_reset", "计时重置")],
      });
    });
  }

  function addHit(side: "red" | "blue", zoneId: string) {
    updateSelectedMatch((match) => recordHit(match, side, zoneId, state.ruleSet));
  }

  function addRoundResult(result: "red" | "blue" | "double" | "none") {
    updateSelectedMatch((match) => recordRoundResult(match, result, state.ruleSet));
  }

  function addWarning(side: "red" | "blue", warningId: string) {
    updateSelectedMatch((match) => applyWarning(match, side, warningId, state.ruleSet));
  }

  function submitAdjudication() {
    updateSelectedMatch((match) => recordAdjudication(match, adjudication, state.ruleSet));
    setAdjudication({ redScoreDelta: 0, blueScoreDelta: 0, redWarningId: "", blueWarningId: "" });
  }

  function undoLastAction() {
    updateSelectedMatch((match) => restorePreviousSnapshot(match));
  }

  function resetCurrentMatch() {
    updateSelectedMatch((match) => resetMatch(match, state.ruleSet));
  }

  function recordCurrentAppeal() {
    updateSelectedMatch((match) => recordAppeal(match));
  }

  function adjustScoreAfterFinish(side: "red" | "blue", delta: number) {
    updateSelectedMatch((match) => adjustFinishedScore(match, side, delta, adjustmentReason, state.ruleSet));
  }

  function adjustWinnerAfterFinish(winner: Winner) {
    updateSelectedMatch((match) => adjustFinishedWinner(match, winner, adjustmentReason));
  }

  function finishManually(winner: Winner) {
    updateSelectedMatch((match) => finishMatch(match, winner, winner === "draw" ? "draw" : "manual"));
  }

  async function handleRuleImport(file: File | null) {
    if (!file) return;
    setRuleMessage("正在导入规则...");
    try {
      const ruleSet = await parseRuleFile(file, state.ruleSet);
      patchState((current) => ({ ...current, ruleSet }));
      setRuleMessage("规则已导入。");
    } catch (error) {
      setRuleMessage(error instanceof Error ? error.message : "规则导入失败。");
    }
  }

  async function handlePlayerImport(file: File | null) {
    if (!file) return;
    setPlayerMessage("正在导入选手...");
    try {
      const players = await parsePlayerFile(file);
      patchState((current) => ({
        ...current,
        event: {
          ...current.event,
          players,
          stage: "setup",
          groupNames: [],
          rankings: [],
          swissRounds: [],
          bracketNodes: [],
        },
      }));
      setPlayerMessage(`已导入 ${players.length} 名选手。`);
    } catch (error) {
      setPlayerMessage(error instanceof Error ? error.message : "选手导入失败。");
    }
  }

  function applyPlayerText() {
    const players = parsePlayersText(playerText);
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        players,
        stage: "setup",
        groupNames: [],
        rankings: [],
        swissRounds: [],
        bracketNodes: [],
      },
    }));
    setPlayerMessage(`已录入 ${players.length} 名选手。`);
  }

  function updateTournamentConfig(patch: Partial<TournamentState["event"]["formatConfig"]>) {
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        formatConfig: { ...current.event.formatConfig, ...patch },
      },
    }));
  }

  function updateEventPointConfig(patch: Partial<TournamentState["event"]["eventPointConfig"]>) {
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        eventPointConfig: { ...current.event.eventPointConfig, ...patch },
      },
    }));
  }

  function updateDisciplineConfig(patch: Partial<TournamentState["event"]["disciplinePointConfig"]>) {
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        disciplinePointConfig: {
          ...current.event.disciplinePointConfig,
          ...patch,
          warningDeductions: patch.warningDeductions ?? current.event.disciplinePointConfig.warningDeductions,
        },
      },
    }));
  }

  function updateWarningDeduction(warningId: string, deduction: number) {
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        disciplinePointConfig: {
          ...current.event.disciplinePointConfig,
          warningDeductions: {
            ...current.event.disciplinePointConfig.warningDeductions,
            [warningId]: deduction,
          },
        },
      },
    }));
  }

  function toggleRankingRule(ruleKey: TournamentState["event"]["rankingRules"][number]["key"], enabled: boolean) {
    patchState((current) => ({
      ...current,
      event: {
        ...current.event,
        rankingRules: current.event.rankingRules.map((rule) => (rule.key === ruleKey ? { ...rule, enabled } : rule)),
      },
    }));
  }

  function moveRankingRule(ruleKey: TournamentState["event"]["rankingRules"][number]["key"], direction: -1 | 1) {
    patchState((current) => {
      const rules = [...current.event.rankingRules].sort((a, b) => a.priority - b.priority);
      const index = rules.findIndex((rule) => rule.key === ruleKey);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= rules.length) return current;
      if (rules[index].key === "playoff" || rules[targetIndex].key === "playoff") return current;
      [rules[index], rules[targetIndex]] = [rules[targetIndex], rules[index]];
      return {
        ...current,
        event: {
          ...current.event,
          rankingRules: rules.map((rule, ruleIndex) => ({ ...rule, priority: rule.key === "playoff" ? 99 : ruleIndex + 1 })),
        },
      };
    });
  }

  function generateGroupMatches() {
    const generated = generateGroupStage(state.event, state.ruleSet);
    const conflictCount = countGroupClubConflicts(generated.event.players);
    patchState((current) => {
      const nonTournamentMatches = current.matches.filter((match) => !match.tournamentStage);
      return {
        ...current,
        event: generated.event,
        matches: [...nonTournamentMatches, ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setActiveView("matches");
    setTournamentMessage(
      state.event.formatConfig.avoidClubInGroups && conflictCount > 0
        ? `已生成小组循环赛；受人数和单位分布限制，仍有 ${conflictCount} 组同单位相遇关系。`
        : "已生成小组循环赛。"
    );
  }

  function generateSwissOpeningRound() {
    patchState((current) => {
      const nonTournamentMatches = current.matches.filter((match) => !match.tournamentStage);
      const generated = generateSwissFirstRound(current.event, current.ruleSet, nonTournamentMatches);
      return {
        ...current,
        event: generated.event,
        matches: [...nonTournamentMatches, ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setActiveView("matches");
    setTournamentMessage("已生成瑞士轮第 1 轮。");
  }

  function lockSwissRound() {
    const round = getCurrentSwissRound(syncedEvent);
    const allFinished = round?.matchIds.every((matchId) => state.matches.find((match) => match.id === matchId)?.status === "finished") ?? false;
    patchState((current) => ({
      ...current,
      event: lockCurrentSwissRound(current.event, current.matches, current.ruleSet),
    }));
    setTournamentMessage(allFinished ? "已锁定当前瑞士轮并刷新排名。" : "当前瑞士轮仍有未完成场次，暂不能锁定。");
  }

  function generateFollowingSwissRound() {
    patchState((current) => {
      const generated = generateNextSwissRound(current.event, current.matches, current.ruleSet);
      return {
        ...current,
        event: generated.event,
        matches: [...current.matches, ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setActiveView("matches");
    setTournamentMessage("已尝试生成下一轮瑞士轮；若未新增场次，请确认当前轮已锁定且未超过配置轮数。");
  }

  function refreshRankings() {
    patchState((current) => ({
      ...current,
      event: refreshTournamentRankings(current.event, current.matches, current.ruleSet),
    }));
    setTournamentMessage(isSwissFormat ? "已刷新瑞士轮排名。" : "已刷新小组排名。");
  }

  function generatePlayoffs() {
    const hasPendingPlayoff = state.matches.some((match) => match.tournamentStage === "playoff" && match.status !== "finished");
    patchState((current) => {
      const generated = generatePlayoffMatches(current.event, current.matches, current.ruleSet);
      return {
        ...current,
        event: generated.event,
        matches: [...current.matches, ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setTournamentMessage(hasPendingPlayoff ? "未生成新附加赛，请先完成已有附加赛或刷新排名。" : "已根据晋级线同分生成附加赛。");
    if (!hasPendingPlayoff) setActiveView("matches");
  }

  function generateBracket() {
    patchState((current) => {
      if (current.event.formatConfig.format === "direct_bracket") {
        const nonTournamentMatches = current.matches.filter((match) => !match.tournamentStage);
        const generated = generateDirectEliminationBracket(current.event, nonTournamentMatches, current.ruleSet);
        return {
          ...current,
          event: generated.event,
          matches: [...nonTournamentMatches, ...generated.matches],
          selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
        };
      }
      if (current.event.formatConfig.format === "double_elimination") {
        const nonTournamentMatches = current.matches.filter((match) => !match.tournamentStage);
        const generated = generateDoubleEliminationBracket(current.event, nonTournamentMatches, current.ruleSet);
        return {
          ...current,
          event: generated.event,
          matches: [...nonTournamentMatches, ...generated.matches],
          selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
        };
      }
      const rankedEvent = refreshTournamentRankings(current.event, current.matches, current.ruleSet);
      const generated = generateInitialBracket(rankedEvent, current.matches, current.ruleSet);
      return {
        ...current,
        event: generated.event,
        matches: [...current.matches.filter((match) => match.tournamentStage !== "bracket" && match.tournamentStage !== "third_place"), ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setActiveView("bracket");
    const drawMode = state.event.formatConfig.useSeeding ? "按种子" : "随机抽签";
    setTournamentMessage(isDoubleEliminationFormat ? `已${drawMode}生成双败淘汰赛胜者组首轮。` : isDirectBracketFormat ? `已${drawMode}生成直接单败淘汰签表。` : "已生成淘汰赛签表。");
  }

  function advanceBracketRound() {
    patchState((current) => {
      const generated = advanceBracket(current.event, current.matches, current.ruleSet);
      return {
        ...current,
        event: generated.event,
        matches: [...current.matches, ...generated.matches],
        selectedMatchId: generated.matches[0]?.id ?? current.selectedMatchId,
      };
    });
    setTournamentMessage("已尝试推进淘汰赛；若仍有未完成场次，请先记录结果。");
  }

  if (isLoading) {
    return <div className="loading">正在加载记录台...</div>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <div>
            <strong>黑马兵击记录台</strong>
            <span>本地控制台</span>
          </div>
        </div>
        <nav>
          {[
            ["home", "首页"],
            ["players", "选手"],
            ["tournament", "编排"],
            ["matches", "场次"],
            ["console", "控制台"],
            ["rankings", "排名"],
            ["bracket", "签表"],
            ["rules", "规则"],
            ["results", "结果"],
          ].map(([key, label]) => (
            <button key={key} className={activeView === key ? "active" : ""} onClick={() => setActiveView(key as ViewKey)}>
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">heima-record</span>
            <h1>{viewTitle(activeView)}</h1>
          </div>
          <div className="save-state">
            <Save size={16} />
            <span>本地自动保存</span>
          </div>
        </header>

        {activeView === "home" && (
          <section className="home-view">
            <div className="home-summary">
              <div>
                <span className="section-kicker">当前赛事</span>
                <h2>{state.name}</h2>
                <p>{tournamentFormatLabel(state.event.formatConfig.format)} · {tournamentStageLabel(syncedEvent.stage)}</p>
              </div>
              <button className="danger-action" onClick={resetTournament}>
                <RotateCcw size={18} />
                重置赛事
              </button>
            </div>
            <div className="home-metrics">
              <div>
                <span>参赛人数</span>
                <strong>{state.event.players.filter((player) => player.status === "active").length}</strong>
              </div>
              <div>
                <span>比赛进度</span>
                <strong>{tournamentProgress.completed} / {tournamentProgress.total}</strong>
              </div>
              <div>
                <span>当前阶段</span>
                <strong>{tournamentStageLabel(syncedEvent.stage)}</strong>
              </div>
            </div>
            <div className="progress-section">
              <div>
                <span>总进度</span>
                <strong>{tournamentProgress.percent}%</strong>
              </div>
              <div className="progress-track" aria-label={`赛事完成进度 ${tournamentProgress.percent}%`}>
                <span style={{ width: `${tournamentProgress.percent}%` }} />
              </div>
            </div>
            <div className="home-actions">
              <button onClick={() => setActiveView("players")}><Home size={18} />管理选手</button>
              <button onClick={() => setActiveView("tournament")}><FileSpreadsheet size={18} />赛事编排</button>
              <button onClick={() => setActiveView("matches")}><TimerReset size={18} />查看场次</button>
            </div>
            {tournamentMessage && <p className="notice">{tournamentMessage}</p>}
          </section>
        )}

        {activeView === "players" && (
          <FileDropZone
            accept=".xlsx,.xls,.csv"
            className="panel tournament-panel"
            dropLabel="松开导入选手名单"
            onFile={handlePlayerImport}
            onReject={setPlayerMessage}
          >
            <div className="result-toolbar">
              <div>
                <h2>选手名单</h2>
                <p>支持粘贴录入，也支持导入 Excel / CSV。每行格式：姓名，单位，种子序号。</p>
              </div>
              <FileImportControl
                accept=".xlsx,.xls,.csv"
                icon={<FolderUp size={18} />}
                label="导入选手"
                onFile={handlePlayerImport}
                onReject={setPlayerMessage}
              />
            </div>
            <div className="player-input-grid">
              <label className="field">
                <span>批量录入</span>
                <textarea value={playerText} onChange={(event) => setPlayerText(event.target.value)} placeholder="张三，黑马，1&#10;李四，黑马，2" />
              </label>
              <div className="stage-actions">
                <button onClick={applyPlayerText}>应用录入名单</button>
              </div>
            </div>
            {playerMessage && <p className="notice">{playerMessage}</p>}
            <DataTable
              headers={["种子", "姓名", "单位", "分组", "状态"]}
              rows={state.event.players.map((player) => [
                player.seed ?? "-",
                player.name,
                player.club || "-",
                player.groupName || "未分组",
                player.status === "active" ? "正常" : "退赛",
              ])}
              emptyText="还没有选手，请先导入或批量录入。"
            />
          </FileDropZone>
        )}

        {activeView === "tournament" && (
          <section className="panel tournament-panel">
            <div className="result-toolbar">
              <div>
                <h2>赛事编排</h2>
                <p>支持小组循环、瑞士轮、直接单败或双败淘汰，统一复用比赛控制台记录结果。</p>
              </div>
              <span className="stage-badge">{tournamentStageLabel(syncedEvent.stage)}</span>
            </div>
            <div className="rules-grid">
              <label className="field">
                <span>赛制</span>
                <select
                  value={state.event.formatConfig.format}
                  onChange={(event) => updateTournamentConfig({ format: event.target.value as TournamentState["event"]["formatConfig"]["format"] })}
                >
                  <option value="group_bracket">小组循环 + 单败淘汰</option>
                  <option value="swiss_bracket">瑞士轮 + 单败淘汰</option>
                  <option value="direct_bracket">直接单败淘汰赛</option>
                  <option value="double_elimination">双败淘汰赛</option>
                </select>
              </label>
              <NumberField
                label="场地数量"
                value={state.event.formatConfig.pisteCount}
                min={1}
                max={26}
                onChange={(value) => updateTournamentConfig({ pisteCount: Math.min(26, Math.max(1, Math.trunc(value || 1))) })}
              />
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={state.event.formatConfig.useSeeding}
                  onChange={(event) => updateTournamentConfig({ useSeeding: event.target.checked })}
                />
                采用种子编排
              </label>
              {isGroupFormat && (
                <>
                  <NumberField label="每组人数" value={state.event.formatConfig.groupSize} onChange={(value) => updateTournamentConfig({ groupSize: value })} />
                  <NumberField label="每组出线人数" value={state.event.formatConfig.groupAdvancers} onChange={(value) => updateTournamentConfig({ groupAdvancers: value })} />
                  <NumberField label="总晋级人数" value={state.event.formatConfig.totalAdvancers} onChange={(value) => updateTournamentConfig({ totalAdvancers: value })} />
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={state.event.formatConfig.avoidClubInGroups}
                      onChange={(event) => updateTournamentConfig({ avoidClubInGroups: event.target.checked })}
                    />
                    小组赛尽量避开同单位
                  </label>
                </>
              )}
              {isSwissFormat && (
                <>
                  <NumberField label="瑞士轮轮数" value={state.event.formatConfig.swissRounds} min={1} onChange={(value) => updateTournamentConfig({ swissRounds: value })} />
                  <NumberField label="瑞士轮晋级人数" value={state.event.formatConfig.swissAdvancers} min={2} onChange={(value) => updateTournamentConfig({ swissAdvancers: value })} />
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={state.event.formatConfig.avoidClubInSwiss}
                      onChange={(event) => updateTournamentConfig({ avoidClubInSwiss: event.target.checked })}
                    />
                    瑞士轮尽量避开同单位
                  </label>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={state.event.formatConfig.allowSwissBye}
                      onChange={(event) => updateTournamentConfig({ allowSwissBye: event.target.checked })}
                    />
                    奇数人数允许轮空
                  </label>
                </>
              )}
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={state.event.formatConfig.generateThirdPlaceMatch}
                  onChange={(event) => updateTournamentConfig({ generateThirdPlaceMatch: event.target.checked })}
                />
                生成季军赛
              </label>
            </div>
            <div className="stage-actions">
              {isGroupFormat && <button onClick={generateGroupMatches} disabled={state.event.players.length < 2}>生成小组循环赛</button>}
              {isSwissFormat && (
                <>
                  <button onClick={generateSwissOpeningRound} disabled={state.event.players.length < 2 || syncedEvent.swissRounds.length > 0}>生成瑞士第 1 轮</button>
                  <button onClick={lockSwissRound} disabled={!currentSwissRound || currentSwissRound.status === "locked"}>锁定当前瑞士轮</button>
                  <button
                    onClick={generateFollowingSwissRound}
                    disabled={!currentSwissRound || currentSwissRound.status !== "locked" || syncedEvent.swissRounds.length >= state.event.formatConfig.swissRounds}
                  >
                    生成下一轮瑞士轮
                  </button>
                </>
              )}
              {!isNoPreliminaryFormat && <button onClick={refreshRankings}>{isSwissFormat ? "刷新瑞士轮排名" : "刷新小组排名"}</button>}
              <button
                onClick={generateBracket}
                disabled={
                  isNoPreliminaryFormat
                    ? state.event.players.filter((player) => player.status === "active").length < 2
                    : liveRankings.filter((ranking) => ranking.advanced).length < 2 || (isSwissFormat && syncedEvent.stage !== "swiss_finished")
                }
              >
                {isDoubleEliminationFormat ? "生成双败淘汰赛" : isDirectBracketFormat ? "生成直接淘汰赛" : "生成淘汰赛"}
              </button>
              <button onClick={advanceBracketRound}>推进淘汰赛</button>
            </div>
            {isSwissFormat && (
              <div className="swiss-round-list">
                {syncedEvent.swissRounds.map((round) => {
                  const byePlayer = round.byePlayerId ? syncedEvent.players.find((player) => player.id === round.byePlayerId) : null;
                  const finishedCount = round.matchIds.filter((matchId) => state.matches.find((match) => match.id === matchId)?.status === "finished").length;
                  return (
                    <div key={round.roundNo} className="swiss-round-row">
                      <strong>第 {round.roundNo} 轮</strong>
                      <span>{round.status === "locked" ? "已锁定" : "已发布"}</span>
                      <small>{finishedCount} / {round.matchIds.length} 场完成{byePlayer ? ` · 轮空：${byePlayer.name}` : ""}</small>
                    </div>
                  );
                })}
              </div>
            )}
            {tournamentMessage && <p className="notice">{tournamentMessage}</p>}
            <div className="metric-grid">
              <div><strong>{state.event.players.length}</strong><span>选手</span></div>
              <div><strong>{isNoPreliminaryFormat ? state.event.players.filter((player) => player.status === "active").length : isSwissFormat ? syncedEvent.swissRounds.length : syncedEvent.groupNames.length}</strong><span>{isNoPreliminaryFormat ? "参赛选手" : isSwissFormat ? "瑞士轮" : "小组"}</span></div>
              <div><strong>{state.matches.filter((match) => isNoPreliminaryFormat ? isBracketStage(match.tournamentStage) : match.tournamentStage === (isSwissFormat ? "swiss" : "group")).length}</strong><span>{isNoPreliminaryFormat ? "淘汰场次" : isSwissFormat ? "瑞士轮场次" : "小组赛"}</span></div>
              <div><strong>{syncedEvent.bracketNodes.length}</strong><span>签表节点</span></div>
            </div>
            {!isNoPreliminaryFormat && (
              <GroupingResultsPanel
                results={groupingResults}
                onExport={() => exportGroupingResultsToExcel({ ...state, event: syncedEvent })}
              />
            )}
            <section className="arrangement-section">
              <div className="result-toolbar">
                <div>
                  <h2>编排结果</h2>
                  <p>未开始的赛事场次可调整场次编号、现场分组和场地；对阵关系由赛制引擎维护。</p>
                </div>
                <div className="result-actions">
                  <button onClick={() => exportArrangementToExcel({ ...state, event: syncedEvent })} disabled={arrangementMatches.length === 0}>
                    <FileSpreadsheet size={18} />
                    导出编排 Excel
                  </button>
                  <button className="danger-action" onClick={clearArrangement} disabled={arrangementMatches.length === 0}>
                    <Trash2 size={18} />
                    清空编排
                  </button>
                </div>
              </div>
              {arrangementMatches.length > 0 ? (
                <div className="table-wrap arrangement-table">
                  <table>
                    <thead>
                      <tr>
                        <th>场次编号</th>
                        <th>阶段 / 轮次</th>
                        <th>现场分组</th>
                        <th>场地</th>
                        <th>对阵</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arrangementMatches.map((match) => {
                        const isEditable = match.status === "pending";
                        return (
                          <tr key={match.id}>
                            <td>
                              <input
                                aria-label={`${match.matchNo} 场场次编号`}
                                value={match.matchNo}
                                disabled={!isEditable}
                                onChange={(event) => patchState((current) => updateArrangementMatch(current, match.id, { matchNo: event.target.value }))}
                              />
                            </td>
                            <td>{tournamentMatchStageLabel(match)}</td>
                            <td>
                              <input
                                aria-label={`${match.matchNo} 场现场分组`}
                                value={match.groupName}
                                disabled={!isEditable}
                                onChange={(event) => patchState((current) => updateArrangementMatch(current, match.id, { groupName: event.target.value }))}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`${match.matchNo} 场场地`}
                                value={match.piste}
                                disabled={!isEditable}
                                onChange={(event) => patchState((current) => updateArrangementMatch(current, match.id, { piste: event.target.value }))}
                              />
                            </td>
                            <td>{match.red.name} vs {match.blue.name}</td>
                            <td>{statusLabel(match.status)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState text="还没有编排结果，请先生成赛事场次。" />
              )}
            </section>
          </section>
        )}

        {activeView === "matches" && (
          <FileDropZone
            accept=".xlsx,.xls,.csv"
            className="match-groups"
            dropLabel="松开导入比赛场次"
            onFile={handleImport}
            onReject={setImportMessage}
          >
            <section className="panel match-import-panel">
              <div className="result-toolbar">
                <div>
                  <h2>导入场次</h2>
                  <p>支持 Excel / CSV。导入会替换现有全部场次，并清空赛事编排结果。</p>
                </div>
                <FileImportControl
                  accept=".xlsx,.xls,.csv"
                  icon={<Upload size={18} />}
                  label="导入场次"
                  onFile={handleImport}
                  onReject={setImportMessage}
                />
              </div>
              {importMessage && <p className="notice">{importMessage}</p>}
            </section>
            {groupedMatches.map((group) => {
              const finishedCount = group.matches.filter((match) => match.status === "finished").length;
              const isImportedGroup = group.matches.every((match) => !match.tournamentStage);
              return (
                <section key={group.name} className="match-group">
                  <div className="match-group-header">
                    <div>
                      <h2>{group.name}</h2>
                      <p>{group.matches.length} 场比赛 · 已结束 {finishedCount} 场</p>
                    </div>
                    <button
                      className="icon-button danger-icon"
                      title={isImportedGroup ? `移除${group.name}` : "赛事编排分组请在编排页统一清空"}
                      aria-label={isImportedGroup ? `移除${group.name}` : `${group.name}不可单独移除`}
                      disabled={!isImportedGroup}
                      onClick={() => removeMatchGroup(group)}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <div className="match-group-grid">
                    {group.matches.map((match) => (
                      <article key={match.id} className={`match-card ${match.id === selectedMatch?.id ? "selected" : ""}`}>
                        <button
                          className="match-card-main"
                          onClick={() => {
                            patchState((current) => ({ ...current, selectedMatchId: match.id }));
                            setActiveView("console");
                          }}
                        >
                          <span>{match.groupName || "未分组"} · {match.piste}</span>
                          <strong>第 {match.matchNo} 场</strong>
                          <p>{match.red.name} vs {match.blue.name}</p>
                          <small>{statusLabel(match.status)} · 胜方：{getWinnerLabel(match.winner, match)}</small>
                        </button>
                        <button
                          className="icon-button match-delete"
                          title={match.tournamentStage ? "赛事编排场次请在编排页统一清空" : "移除场次"}
                          aria-label={match.tournamentStage ? `第 ${match.matchNo} 场不可单独移除` : `移除第 ${match.matchNo} 场`}
                          disabled={Boolean(match.tournamentStage)}
                          onClick={() => removeMatch(match)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
            {state.matches.length === 0 && <EmptyState text="还没有场次，请先导入 Excel 或 CSV。" />}
          </FileDropZone>
        )}

        {activeView === "console" && (
          selectedMatch ? (
            <section className="console-layout">
              <div className="match-tools">
                <button onClick={undoLastAction} disabled={(selectedMatch.history ?? []).length === 0}>撤销</button>
                <button onClick={recordCurrentAppeal}>记录申诉</button>
                <button onClick={resetCurrentMatch}>重置比赛</button>
                <span>胜方：{getWinnerLabel(selectedMatch.winner, selectedMatch)}</span>
              </div>
              <div className="scoreboard">
                <FighterPanel side="red" match={selectedMatch} ruleSet={state.ruleSet} onHit={addHit} onWarning={addWarning} />
                <div className="timer-panel">
                  <span>{getTimerLabel(selectedMatch, state.ruleSet)}</span>
                  <strong>{formatTime(selectedMatch.remainingSeconds)}</strong>
                  {state.ruleSet.scoringMode === "round_limit" && (
                    <RoundPanel match={selectedMatch} ruleSet={state.ruleSet} onRound={addRoundResult} />
                  )}
                  <div className="timer-actions">
                    <button title="开始" onClick={() => setMatchStatus("running")} disabled={selectedMatch.status === "finished"}>
                      <Play size={20} />
                    </button>
                    <button title="暂停" onClick={() => setMatchStatus("paused")} disabled={selectedMatch.status === "finished"}>
                      <Pause size={20} />
                    </button>
                    <button title="重置计时" onClick={resetTimer} disabled={selectedMatch.status === "finished"}>
                      <RotateCcw size={20} />
                    </button>
                  </div>
                  <div className="finish-actions">
                    <button onClick={() => finishManually("red")} disabled={selectedMatch.status === "finished"}>红方胜</button>
                    <button onClick={() => finishManually("draw")} disabled={selectedMatch.status === "finished"}>平局</button>
                    <button onClick={() => finishManually("blue")} disabled={selectedMatch.status === "finished"}>蓝方胜</button>
                  </div>
                  <p>{statusLabel(selectedMatch.status)} · {getEndReasonLabel(selectedMatch.endReason)}</p>
                </div>
                <FighterPanel side="blue" match={selectedMatch} ruleSet={state.ruleSet} onHit={addHit} onWarning={addWarning} />
              </div>
              <ComprehensiveJudgement
                match={selectedMatch}
                ruleSet={state.ruleSet}
                value={adjudication}
                onChange={setAdjudication}
                onSubmit={submitAdjudication}
              />
              {selectedMatch.status === "finished" && (
                <div className="post-adjustment">
                  <div>
                    <h2>赛后修正</h2>
                    <p>申诉或仲裁后修改结果，必须填写原因并自动留痕。</p>
                  </div>
                  <label className="field">
                    <span>修正原因</span>
                    <input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="例如：申诉成立、仲裁改判" />
                  </label>
                  <div className="result-actions">
                    <button onClick={() => adjustScoreAfterFinish("red", 1)}>红方 +1</button>
                    <button onClick={() => adjustScoreAfterFinish("red", -1)}>红方 -1</button>
                    <button onClick={() => adjustScoreAfterFinish("blue", 1)}>蓝方 +1</button>
                    <button onClick={() => adjustScoreAfterFinish("blue", -1)}>蓝方 -1</button>
                    <button onClick={() => adjustWinnerAfterFinish("red")}>改红方胜</button>
                    <button onClick={() => adjustWinnerAfterFinish("draw")}>改平局</button>
                    <button onClick={() => adjustWinnerAfterFinish("blue")}>改蓝方胜</button>
                  </div>
                </div>
              )}
              <div className="event-log">
                <h2>操作记录</h2>
                {selectedMatch.events.slice().reverse().map((event) => (
                  <div key={event.id} className="event-row">
                    <span>{new Date(event.at).toLocaleTimeString()}</span>
                    <strong>{event.label}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <EmptyState text="请选择或导入一场比赛。" />
          )
        )}

        {activeView === "rankings" && (
          <section className="panel tournament-panel">
            <div className="result-toolbar">
              <div>
                <h2>{isNoPreliminaryFormat ? "预赛排名" : isSwissFormat ? "瑞士轮排名" : "小组排名"}</h2>
                <p>{isNoPreliminaryFormat ? "当前淘汰赛制不经过预赛排名，签表按选手种子生成。" : "排名按下方规则顺序计算；晋级线完全同分时可生成附加赛。"}</p>
              </div>
              {!isNoPreliminaryFormat && (
                <div className="stage-actions">
                  <button onClick={refreshRankings}>刷新排名</button>
                  <button onClick={generatePlayoffs} disabled={!liveRankings.some((ranking) => ranking.needsPlayoff)}>生成附加赛</button>
                </div>
              )}
            </div>
            {isNoPreliminaryFormat ? (
              <EmptyState text="当前淘汰赛制不需要预赛排名，请在编排页生成签表。" />
            ) : (
              <>
                <RankingConfigPanel
                  state={state}
                  onEventPointChange={updateEventPointConfig}
                  onDisciplineChange={updateDisciplineConfig}
                  onWarningDeductionChange={updateWarningDeduction}
                  onRuleToggle={toggleRankingRule}
                  onRuleMove={moveRankingRule}
                />
                {syncedEvent.groupNames.map((groupName) => (
                  <div key={groupName} className="ranking-section">
                    <h2>{groupName}</h2>
                    <DataTable
                      headers={[isSwissFormat ? "瑞士轮名次" : "组内名次", "选手", "积分", "胜", "平", "负", "净胜分", "纪律扣分", "晋级", "附加赛"]}
                      rows={liveRankings
                        .filter((ranking) => ranking.groupName === groupName)
                        .map((ranking) => [
                          ranking.rank,
                          `${ranking.name}${ranking.club ? `（${ranking.club}）` : ""}`,
                          ranking.eventPoints,
                          ranking.realWins,
                          ranking.draws,
                          ranking.losses,
                          ranking.scoreDiff,
                          ranking.disciplinePenalty,
                          ranking.advanced ? "是" : "否",
                          ranking.needsPlayoff ? "需要" : "-",
                        ])}
                      emptyText={isSwissFormat ? "暂无排名，请先生成瑞士轮并记录结果。" : "暂无排名，请先生成小组赛并记录结果。"}
                    />
                  </div>
                ))}
                {syncedEvent.groupNames.length === 0 && <EmptyState text={isSwissFormat ? "暂无瑞士轮排名，请先在编排页生成瑞士轮。" : "暂无分组，请先在编排页生成小组循环赛。"} />}
              </>
            )}
          </section>
        )}

        {activeView === "bracket" && (
          <section className="panel tournament-panel">
            <div className="result-toolbar">
              <div>
                <h2>淘汰签表</h2>
                <p>{isDoubleEliminationFormat ? "双败按胜者组、败者组和总决赛推进；选手第二负后淘汰。" : "签表按排名种子生成，非 2 的幂人数会给高种子轮空；半决赛后生成季军赛。"}</p>
              </div>
              <button className="primary-action" onClick={advanceBracketRound}>推进淘汰赛</button>
            </div>
            <div className="bracket-list">
              {syncedEvent.bracketNodes.map((node) => {
                const match = node.matchId ? state.matches.find((item) => item.id === node.matchId) : null;
                return (
                  <div key={node.id} className="bracket-node">
                    <span>{bracketStageLabel(node.stage)} · 第 {node.roundNo} 轮</span>
                    <strong>{node.label}</strong>
                    <p>{match ? `${match.red.name} vs ${match.blue.name}` : "轮空晋级"}</p>
                    <small>{bracketStatusLabel(node.status)}{match?.winner ? ` · 胜方：${getWinnerLabel(match.winner, match)}` : ""}</small>
                  </div>
                );
              })}
            </div>
            {syncedEvent.bracketNodes.length === 0 && <EmptyState text="暂无签表，请先生成淘汰赛。" />}
          </section>
        )}

        {activeView === "rules" && (
          <FileDropZone
            accept=".xlsx,.xls,.csv"
            className="panel rules-panel"
            dropLabel="松开导入比赛规则"
            onFile={handleRuleImport}
            onReject={setRuleMessage}
          >
            <div className="result-toolbar">
              <div>
                <h2>规则文件</h2>
                <p>支持 XLSX 多工作表，也支持单个 CSV 规则表。</p>
              </div>
              <div className="result-actions">
                <FileImportControl
                  accept=".xlsx,.xls,.csv"
                  icon={<FolderUp size={18} />}
                  label="导入规则"
                  onFile={handleRuleImport}
                  onReject={setRuleMessage}
                />
                <button onClick={() => exportRuleSetToExcel(state.ruleSet)}><FileSpreadsheet size={18} />导出规则 XLSX</button>
              </div>
            </div>
            {ruleMessage && <p className="notice">{ruleMessage}</p>}
            <div className="rules-grid">
              <label className="field">
                <span>计分模式</span>
                <select value={state.ruleSet.scoringMode} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, scoringMode: event.target.value as RuleSet["scoringMode"] } }))}>
                  <option value="target_score">目标分模式</option>
                  <option value="round_limit">限制回合模式</option>
                </select>
              </label>
              <NumberField label="比赛时长（秒）" value={state.ruleSet.durationSeconds} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, durationSeconds: value } }))} />
              <NumberField label="目标分" value={state.ruleSet.targetScore} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, targetScore: value } }))} />
              <NumberField label="最大回合数" value={state.ruleSet.maxRounds} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, maxRounds: value } }))} />
              <NumberField label="加时时长（秒）" value={state.ruleSet.overtimeSeconds} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, overtimeSeconds: value } }))} />
              <NumberField label="处罚判负次数" value={state.ruleSet.maxPenaltyCount} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, maxPenaltyCount: value } }))} />
              <label className="toggle-row">
                <input type="checkbox" checked={state.ruleSet.allowDoubleHit} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, allowDoubleHit: event.target.checked } }))} />
                允许双方得分
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={state.ruleSet.allowNoHitRound} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, allowNoHitRound: event.target.checked } }))} />
                允许无效回合
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={state.ruleSet.allowDraw} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, allowDraw: event.target.checked } }))} />
                允许平局
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={state.ruleSet.enableOvertime} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, enableOvertime: event.target.checked } }))} />
                启用加时
              </label>
            </div>
            <RuleSummary ruleSet={state.ruleSet} />
          </FileDropZone>
        )}

        {activeView === "results" && (
          <FileDropZone
            accept=".json,application/json"
            className="panel results-panel"
            dropLabel="松开导入完整备份"
            onFile={handleBackupImport}
            onReject={setBackupMessage}
          >
            <div className="result-toolbar">
              <div>
                <h2>成绩导出</h2>
                <p>用于提交或归档比赛结果，不用于完整恢复现场状态。</p>
              </div>
              <div className="result-actions">
                <button onClick={() => exportTournamentResultsToExcel({ ...state, event: syncedEvent }, liveRankings)}><FileSpreadsheet size={18} />导出赛事结果 Excel</button>
                <button onClick={() => exportMatchesToCsv(state.matches)}><Download size={18} />导出 CSV</button>
                <button onClick={() => exportMatchesToExcel(state.matches)}><FileSpreadsheet size={18} />导出 Excel</button>
              </div>
            </div>
            <div className="backup-box">
              <div>
                <h2>完整备份</h2>
                <p>保存规则、场次、比分、计时状态和操作记录，可在刷新、换电脑或清理浏览器数据后恢复。</p>
              </div>
              <div className="result-actions">
                <button onClick={() => exportStateBackup(state)}><Download size={18} />导出备份 JSON</button>
                <FileImportControl
                  accept=".json,application/json"
                  icon={<FolderUp size={18} />}
                  label="导入备份 JSON"
                  onFile={handleBackupImport}
                  onReject={setBackupMessage}
                />
              </div>
            </div>
            {backupMessage && <p className="notice">{backupMessage}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>场次</th>
                    <th>对阵</th>
                    <th>比分</th>
                    <th>警告/处罚</th>
                    <th>胜方</th>
                    <th>结束原因</th>
                  </tr>
                </thead>
                <tbody>
                  {state.matches.map((match) => (
                    <tr key={match.id}>
                      <td>{match.matchNo}</td>
                      <td>{match.red.name} vs {match.blue.name}</td>
                      <td>{match.redScore}:{match.blueScore}</td>
                      <td>红 {formatWarningCounts(match.redWarnings, state.ruleSet)} / 罚 {match.redPenalties}；蓝 {formatWarningCounts(match.blueWarnings, state.ruleSet)} / 罚 {match.bluePenalties}</td>
                      <td>{getWinnerLabel(match.winner, match)}</td>
                      <td>{getEndReasonLabel(match.endReason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FileDropZone>
        )}
      </section>
    </main>
  );
}

function viewTitle(view: ViewKey) {
  const titles: Record<ViewKey, string> = {
    home: "赛事首页",
    players: "选手名单",
    tournament: "赛事编排",
    matches: "比赛场次",
    console: "比赛控制台",
    rankings: "赛事排名",
    bracket: "淘汰签表",
    rules: "规则配置",
    results: "结果导出",
  };
  return titles[view];
}

function tournamentFormatLabel(format: TournamentState["event"]["formatConfig"]["format"]) {
  const labels: Record<TournamentState["event"]["formatConfig"]["format"], string> = {
    group_bracket: "小组循环 + 单败淘汰",
    swiss_bracket: "瑞士轮 + 单败淘汰",
    direct_bracket: "直接单败淘汰赛",
    double_elimination: "双败淘汰赛",
  };
  return labels[format];
}

function statusLabel(status: Match["status"]) {
  const labels: Record<Match["status"], string> = {
    pending: "未开始",
    running: "进行中",
    paused: "已暂停",
    finished: "已结束",
  };
  return labels[status];
}

function tournamentStageLabel(stage: TournamentState["event"]["stage"]) {
  const labels: Record<TournamentState["event"]["stage"], string> = {
    setup: "未编排",
    group_ready: "小组赛",
    group_finished: "小组赛完成",
    swiss_ready: "瑞士轮",
    swiss_finished: "瑞士轮完成",
    bracket_ready: "淘汰赛",
    finished: "赛事完成",
  };
  return labels[stage];
}

function bracketStatusLabel(status: TournamentState["event"]["bracketNodes"][number]["status"]) {
  const labels: Record<TournamentState["event"]["bracketNodes"][number]["status"], string> = {
    bye: "轮空",
    ready: "待比赛",
    finished: "已完成",
  };
  return labels[status];
}

function bracketStageLabel(stage: TournamentState["event"]["bracketNodes"][number]["stage"]) {
  const labels: Partial<Record<TournamentState["event"]["bracketNodes"][number]["stage"], string>> = {
    bracket: "单败淘汰",
    third_place: "季军赛",
    winner_bracket: "胜者组",
    loser_bracket: "败者组",
    grand_final: "总决赛",
  };
  return labels[stage] ?? "淘汰赛";
}

function tournamentMatchStageLabel(match: Match) {
  if (!match.tournamentStage) return "普通场次";
  if (match.tournamentStage === "group") return "小组循环";
  if (match.tournamentStage === "swiss") return `瑞士轮第 ${match.tournamentRound ?? "-"} 轮`;
  if (match.tournamentStage === "playoff") return "附加赛";
  return `${bracketStageLabel(match.tournamentStage)}第 ${match.tournamentRound ?? "-"} 轮`;
}

function isBracketStage(stage: Match["tournamentStage"]) {
  return stage === "bracket" || stage === "third_place" || stage === "winner_bracket" || stage === "loser_bracket" || stage === "grand_final";
}

function groupMatchesByName(matches: Match[]): MatchGroup[] {
  const groups = new Map<string, Match[]>();
  // 按导入顺序创建分组，避免现场排场顺序被展示层重新打乱。
  matches.forEach((match) => {
    const groupName = match.groupName.trim() || "未分组";
    groups.set(groupName, [...(groups.get(groupName) ?? []), match]);
  });
  return Array.from(groups, ([name, groupMatches]) => ({ name, matches: groupMatches }));
}

function getTimerLabel(match: Match, ruleSet: RuleSet) {
  if (ruleSet.scoringMode !== "round_limit") return match.isOvertime ? "加时" : "常规时间";
  if (match.isOvertime) return `加时第 ${Math.max(1, match.currentRound - ruleSet.maxRounds)} 回合`;
  return `第 ${Math.min(match.currentRound, ruleSet.maxRounds)} / ${ruleSet.maxRounds} 回合`;
}

function ComprehensiveJudgement(props: {
  match: Match;
  ruleSet: RuleSet;
  value: AdjudicationInput;
  onChange: (value: AdjudicationInput) => void;
  onSubmit: () => void;
}) {
  const isRoundExhausted = props.ruleSet.scoringMode === "round_limit" && !props.match.isOvertime && props.match.currentRound > props.ruleSet.maxRounds;
  const isLocked = props.match.status === "finished" || isRoundExhausted;
  const update = (patch: Partial<AdjudicationInput>) => props.onChange({ ...props.value, ...patch });

  return (
    <div className="adjudication-panel">
      <div>
        <h2>综合判定</h2>
        <p>{props.ruleSet.scoringMode === "round_limit" ? "按本回合一次提交双方得分和判罚。" : "一次提交双方得分和判罚。"}</p>
      </div>
      <div className="adjudication-grid">
        <label className="field">
          <span>红方得分</span>
          <input type="number" min={0} value={props.value.redScoreDelta} onChange={(event) => update({ redScoreDelta: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>蓝方得分</span>
          <input type="number" min={0} value={props.value.blueScoreDelta} onChange={(event) => update({ blueScoreDelta: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>红方警告</span>
          <select value={props.value.redWarningId} onChange={(event) => update({ redWarningId: event.target.value })}>
            <option value="">无</option>
            {props.ruleSet.warningLevels.map((warning) => (
              <option key={warning.id} value={warning.id}>{warning.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>蓝方警告</span>
          <select value={props.value.blueWarningId} onChange={(event) => update({ blueWarningId: event.target.value })}>
            <option value="">无</option>
            {props.ruleSet.warningLevels.map((warning) => (
              <option key={warning.id} value={warning.id}>{warning.label}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="primary-action" onClick={props.onSubmit} disabled={isLocked}>提交综合判定</button>
    </div>
  );
}

function GroupingResultsPanel(props: { results: TournamentGroupingResults; onExport: () => void }) {
  const available = hasGroupingResults(props.results);
  return (
    <section className="grouping-results-section">
      <div className="result-toolbar">
        <div>
          <h2>选手分组结果</h2>
          <p>{props.results.kind === "swiss" ? "瑞士轮按轮次展示现场分组" : "小组循环固定分组名单"}</p>
        </div>
        <button className="primary-action grouping-export" onClick={props.onExport} disabled={!available}>
          <FileSpreadsheet size={18} />
          导出分组结果
        </button>
      </div>
      {!available && <EmptyState text="生成比赛后将在此显示选手分组结果。" />}
      {available && props.results.kind === "group" && (
        <div className="grouping-result-grid">
          {props.results.groups.map((group) => (
            <section key={group.name} className="grouping-result-group">
              <div className="grouping-result-title">
                <h3>{group.name}</h3>
                <span>{group.players.length} 人</span>
              </div>
              <div className="grouping-player-list">
                {group.players.map((player, index) => (
                  <div key={player.id} className="grouping-player-row">
                    <span>{index + 1}</span>
                    <strong>{player.name}</strong>
                    <small>{player.club || "未填写单位"}</small>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {available && props.results.kind === "swiss" && (
        <div className="grouping-round-list">
          {props.results.rounds.map((round) => (
            <section key={round.roundNo} className="grouping-round-section">
              <div className="grouping-result-title">
                <h3>第 {round.roundNo} 轮</h3>
                <span>{round.status === "locked" ? "已锁定" : "已发布"}</span>
              </div>
              <div className="grouping-result-grid">
                {round.groups.map((group) => (
                  <section key={group.name} className="grouping-result-group">
                    <div className="grouping-result-title">
                      <h3>{group.name}</h3>
                      <span>{group.matches.length} 场</span>
                    </div>
                    <div className="grouping-match-list">
                      {group.matches.map((match) => (
                        <div key={match.id} className="grouping-match-row">
                          <strong>{match.red.name} vs {match.blue.name}</strong>
                          <span>第 {match.matchNo} 场 · {match.piste}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {round.byePlayer && (
                <div className="grouping-bye-row">
                  <span>本轮轮空</span>
                  <strong>{round.byePlayer.name}</strong>
                  <small>{round.byePlayer.club || "未填写单位"}</small>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function DataTable(props: { headers: string[]; rows: Array<Array<string | number>>; emptyText: string }) {
  if (props.rows.length === 0) return <EmptyState text={props.emptyText} />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {props.headers.map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join("-")}`}>
              {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingConfigPanel(props: {
  state: TournamentState;
  onEventPointChange: (patch: Partial<TournamentState["event"]["eventPointConfig"]>) => void;
  onDisciplineChange: (patch: Partial<TournamentState["event"]["disciplinePointConfig"]>) => void;
  onWarningDeductionChange: (warningId: string, deduction: number) => void;
  onRuleToggle: (ruleKey: TournamentState["event"]["rankingRules"][number]["key"], enabled: boolean) => void;
  onRuleMove: (ruleKey: TournamentState["event"]["rankingRules"][number]["key"], direction: -1 | 1) => void;
}) {
  const sortedRules = [...props.state.event.rankingRules].sort((a, b) => a.priority - b.priority);
  return (
    <div className="ranking-config">
      <section>
        <h2>赛事积分</h2>
        <div className="rules-grid">
          <NumberField label="胜" value={props.state.event.eventPointConfig.win} onChange={(value) => props.onEventPointChange({ win: value })} />
          <NumberField label="平" value={props.state.event.eventPointConfig.draw} onChange={(value) => props.onEventPointChange({ draw: value })} />
          <NumberField label="负" value={props.state.event.eventPointConfig.loss} onChange={(value) => props.onEventPointChange({ loss: value })} />
          <NumberField label="双负" value={props.state.event.eventPointConfig.doubleLoss} onChange={(value) => props.onEventPointChange({ doubleLoss: value })} />
        </div>
      </section>
      <section>
        <h2>排名规则</h2>
        <div className="ranking-rule-list">
          {sortedRules.map((rule, index) => (
            <div key={rule.key} className="ranking-rule-row">
              <label>
                <input type="checkbox" checked={rule.enabled} onChange={(event) => props.onRuleToggle(rule.key, event.target.checked)} />
                {rule.label}
              </label>
              <span>优先级 {rule.priority}</span>
              <div className="inline-actions">
                <button onClick={() => props.onRuleMove(rule.key, -1)} disabled={rule.key === "playoff" || index === 0}>上移</button>
                <button onClick={() => props.onRuleMove(rule.key, 1)} disabled={rule.key === "playoff" || sortedRules[index + 1]?.key === "playoff"}>下移</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>纪律扣分</h2>
        <label className="toggle-row compact-toggle">
          <input
            type="checkbox"
            checked={props.state.event.disciplinePointConfig.applyToEventPoints}
            onChange={(event) => props.onDisciplineChange({ applyToEventPoints: event.target.checked })}
          />
          计入赛事积分
        </label>
        <div className="discipline-grid">
          {props.state.ruleSet.warningLevels.map((warning) => (
            <label key={warning.id} className="field">
              <span>{warning.label}</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={props.state.event.disciplinePointConfig.warningDeductions[warning.id] ?? Math.abs(warning.scoreDelta)}
                onChange={(event) => props.onWarningDeductionChange(warning.id, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function FighterPanel(props: {
  side: "red" | "blue";
  match: Match;
  ruleSet: RuleSet;
  onHit: (side: "red" | "blue", zoneId: string) => void;
  onWarning: (side: "red" | "blue", warningId: string) => void;
}) {
  const fighter = props.side === "red" ? props.match.red : props.match.blue;
  const score = props.side === "red" ? props.match.redScore : props.match.blueScore;
  const penalties = props.side === "red" ? props.match.redPenalties : props.match.bluePenalties;
  const warnings = props.side === "red" ? props.match.redWarnings : props.match.blueWarnings;
  const sideLabel = props.side === "red" ? "红方" : "蓝方";
  const isLocked = props.match.status === "finished";
  const isRoundMode = props.ruleSet.scoringMode === "round_limit";

  return (
    <div className={`fighter-panel ${props.side}`}>
      <span>{sideLabel}</span>
      <h2>{fighter.name}</h2>
      <p>{fighter.club || "未填写单位"}</p>
      <strong>{score}</strong>
      {!isRoundMode && (
        <div className="zone-actions">
          {props.ruleSet.hitZones.filter((zone) => zone.enabled).map((zone) => (
            <button key={zone.id} onClick={() => props.onHit(props.side, zone.id)} disabled={isLocked}>
              {zone.label} +{zone.score}
            </button>
          ))}
        </div>
      )}
      <div className="warning-actions">
        {props.ruleSet.warningLevels.map((warning) => (
          <button key={warning.id} onClick={() => props.onWarning(props.side, warning.id)} disabled={isLocked}>
            <ShieldAlert size={16} />
            {warning.label}
          </button>
        ))}
      </div>
      <p className="fighter-meta">处罚 {penalties} · 警告 {formatWarningCounts(warnings, props.ruleSet)}</p>
    </div>
  );
}

function RoundPanel(props: { match: Match; ruleSet: RuleSet; onRound: (result: "red" | "blue" | "double" | "none") => void }) {
  const isLocked = props.match.status === "finished" || (!props.match.isOvertime && props.match.currentRound > props.ruleSet.maxRounds);
  return (
    <div className="round-panel">
      <button onClick={() => props.onRound("red")} disabled={isLocked}>红方本回合得分</button>
      <button onClick={() => props.onRound("blue")} disabled={isLocked}>蓝方本回合得分</button>
      <button onClick={() => props.onRound("double")} disabled={isLocked || !props.ruleSet.allowDoubleHit}>双方得分</button>
      <button onClick={() => props.onRound("none")} disabled={isLocked || !props.ruleSet.allowNoHitRound}>无效回合</button>
      <small>{props.match.isOvertime ? `已进入加时，累计记录 ${props.match.roundRecords.length} 回合` : `已记录 ${props.match.roundRecords.length} / ${props.ruleSet.maxRounds} 回合`}</small>
    </div>
  );
}

function formatWarningCounts(warnings: Record<string, number>, ruleSet: RuleSet) {
  const values = ruleSet.warningLevels
    .map((warning) => `${warning.label}${warnings[warning.id] ?? 0}`)
    .filter(Boolean);
  return values.join(" / ");
}

function RuleSummary(props: { ruleSet: RuleSet }) {
  return (
    <div className="rule-summary">
      <div>
        <h2>计分模式</h2>
        <p>{props.ruleSet.scoringMode === "round_limit" ? `限制回合模式：最多 ${props.ruleSet.maxRounds} 回合` : `目标分模式：先到 ${props.ruleSet.targetScore} 分`}</p>
        <p>双方得分：{props.ruleSet.allowDoubleHit ? "允许" : "不允许"}；无效回合：{props.ruleSet.allowNoHitRound ? "允许" : "不允许"}</p>
      </div>
      <div>
        <h2>部位分值</h2>
        {props.ruleSet.hitZones.map((zone) => (
          <p key={zone.id}>{zone.label}：{zone.score} 分，{zone.enabled ? "启用" : "停用"}</p>
        ))}
      </div>
      <div>
        <h2>警告分级</h2>
        {props.ruleSet.warningLevels.map((warning) => (
          <p key={warning.id}>
            {warning.label}：扣 {Math.abs(warning.scoreDelta)} 分，{warning.isPenalty ? "计处罚" : "不计处罚"}，{warning.stopsMatch || warning.isForfeit ? `中止：${stopResultLabel(warning.stopResult)}` : "不中止"}
          </p>
        ))}
      </div>
      <div>
        <h2>转换机制</h2>
        {props.ruleSet.warningConversions.map((item) => (
          <p key={`${item.fromWarningId}-${item.toWarningId}`}>{item.fromWarningId} 累计 {item.count} 次转 {item.toWarningId}</p>
        ))}
      </div>
    </div>
  );
}

function stopResultLabel(result: RuleSet["warningLevels"][number]["stopResult"]) {
  const labels: Record<RuleSet["warningLevels"][number]["stopResult"], string> = {
    opponent_win: "对方胜",
    self_win: "本人胜",
    draw: "平局",
    manual: "手动判定",
  };
  return labels[result];
}

function NumberField(props: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="number" min={props.min ?? 0} max={props.max} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    </label>
  );
}

function EmptyState(props: { text: string }) {
  return (
    <div className="empty-state">
      <TimerReset size={32} />
      <strong>{props.text}</strong>
    </div>
  );
}

export default App;
