import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FolderUp,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldAlert,
  TimerReset,
  Upload,
} from "lucide-react";
import {
  createMatchEvent,
  evaluateAfterScore,
  evaluateTimeUp,
  finishMatch,
  formatTime,
  getEndReasonLabel,
  getWinnerLabel,
  touch,
} from "./domain/rules";
import { exportStateBackup, parseStateBackup } from "./services/backup";
import { exportMatchesToCsv, exportMatchesToExcel } from "./services/exporter";
import { parseMatchFile } from "./services/importer";
import { createInitialState, loadState, saveState } from "./services/storage";
import type { Match, TournamentState, Winner } from "./types";

type ViewKey = "import" | "matches" | "console" | "rules" | "results";

function App() {
  const [state, setState] = useState<TournamentState>(createInitialState);
  const [activeView, setActiveView] = useState<ViewKey>("import");
  const [isLoading, setIsLoading] = useState(true);
  const [importMessage, setImportMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const saveTimer = useRef<number | null>(null);

  const selectedMatch = useMemo(
    () => state.matches.find((match) => match.id === state.selectedMatchId) ?? state.matches[0] ?? null,
    [state.matches, state.selectedMatchId]
  );

  useEffect(() => {
    loadState()
      .then((stored) => {
        setState(stored);
        if (stored.matches.length > 0) setActiveView("matches");
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
    setImportMessage("正在解析文件...");
    try {
      const matches = await parseMatchFile(file, state.ruleSet);
      if (matches.length === 0) {
        setImportMessage("没有识别到有效场次，请检查红方、蓝方字段。");
        return;
      }
      patchState((current) => ({
        ...current,
        matches,
        selectedMatchId: matches[0]?.id ?? null,
      }));
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
      setActiveView("matches");
      setBackupMessage(`已恢复备份，包含 ${backupState.matches.length} 场比赛。`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "恢复失败，请检查 JSON 备份文件。");
    }
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

  function changeScore(side: "red" | "blue", delta: number) {
    updateSelectedMatch((match) => {
      const redScore = side === "red" ? Math.max(0, match.redScore + delta) : match.redScore;
      const blueScore = side === "blue" ? Math.max(0, match.blueScore + delta) : match.blueScore;
      const sideLabel = side === "red" ? "红方" : "蓝方";
      const next = touch({
        ...match,
        redScore,
        blueScore,
        events: [...match.events, createMatchEvent(match.id, "score_changed", `${sideLabel}${delta > 0 ? "加" : "减"}${Math.abs(delta)}分`)],
      });
      return evaluateAfterScore(next, state.ruleSet);
    });
  }

  function addPenalty(side: "red" | "blue") {
    updateSelectedMatch((match) => {
      const redPenalties = side === "red" ? match.redPenalties + 1 : match.redPenalties;
      const bluePenalties = side === "blue" ? match.bluePenalties + 1 : match.bluePenalties;
      const scoreSide = side === "red" ? "redScore" : "blueScore";
      const sideLabel = side === "red" ? "红方" : "蓝方";
      const score = Math.max(0, match[scoreSide] - state.ruleSet.penaltyDeduction);
      const next = touch({
        ...match,
        redPenalties,
        bluePenalties,
        [scoreSide]: score,
        events: [...match.events, createMatchEvent(match.id, "penalty_added", `${sideLabel}处罚，扣${state.ruleSet.penaltyDeduction}分`)],
      });

      // 处罚达到上限时直接判负，避免现场继续操作造成结果歧义。
      if (state.ruleSet.maxPenaltyCount > 0) {
        if (redPenalties >= state.ruleSet.maxPenaltyCount) return finishMatch(next, "blue", "forfeit");
        if (bluePenalties >= state.ruleSet.maxPenaltyCount) return finishMatch(next, "red", "forfeit");
      }
      return next;
    });
  }

  function finishManually(winner: Winner) {
    updateSelectedMatch((match) => finishMatch(match, winner, winner === "draw" ? "draw" : "manual"));
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
            ["import", "导入"],
            ["matches", "场次"],
            ["console", "控制台"],
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

        {activeView === "import" && (
          <section className="panel import-panel">
            <label className="dropzone">
              <Upload size={28} />
              <strong>导入 Excel / CSV 场次表</strong>
              <span>支持 .xlsx、.xls、.csv，红方和蓝方姓名为必填字段</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => handleImport(event.target.files?.[0] ?? null)} />
            </label>
            {importMessage && <p className="notice">{importMessage}</p>}
          </section>
        )}

        {activeView === "matches" && (
          <section className="match-grid">
            {state.matches.map((match) => (
              <button
                key={match.id}
                className={`match-card ${match.id === selectedMatch?.id ? "selected" : ""}`}
                onClick={() => {
                  patchState((current) => ({ ...current, selectedMatchId: match.id }));
                  setActiveView("console");
                }}
              >
                <span>{match.groupName} · {match.piste}</span>
                <strong>第 {match.matchNo} 场</strong>
                <p>{match.red.name} vs {match.blue.name}</p>
                <small>{statusLabel(match.status)} · {getWinnerLabel(match.winner, match)}</small>
              </button>
            ))}
            {state.matches.length === 0 && <EmptyState text="还没有场次，请先导入 Excel 或 CSV。" />}
          </section>
        )}

        {activeView === "console" && (
          selectedMatch ? (
            <section className="console-layout">
              <div className="scoreboard">
                <FighterPanel side="red" match={selectedMatch} onScore={changeScore} onPenalty={addPenalty} />
                <div className="timer-panel">
                  <span>{selectedMatch.isOvertime ? "加时" : "常规时间"}</span>
                  <strong>{formatTime(selectedMatch.remainingSeconds)}</strong>
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
                    <button onClick={() => finishManually("red")}>红方胜</button>
                    <button onClick={() => finishManually("draw")}>平局</button>
                    <button onClick={() => finishManually("blue")}>蓝方胜</button>
                  </div>
                  <p>{statusLabel(selectedMatch.status)} · {getEndReasonLabel(selectedMatch.endReason)}</p>
                </div>
                <FighterPanel side="blue" match={selectedMatch} onScore={changeScore} onPenalty={addPenalty} />
              </div>
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

        {activeView === "rules" && (
          <section className="panel rules-grid">
            <NumberField label="比赛时长（秒）" value={state.ruleSet.durationSeconds} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, durationSeconds: value } }))} />
            <NumberField label="目标分" value={state.ruleSet.targetScore} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, targetScore: value } }))} />
            <NumberField label="加时时长（秒）" value={state.ruleSet.overtimeSeconds} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, overtimeSeconds: value } }))} />
            <NumberField label="处罚扣分" value={state.ruleSet.penaltyDeduction} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, penaltyDeduction: value } }))} />
            <NumberField label="处罚判负次数" value={state.ruleSet.maxPenaltyCount} onChange={(value) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, maxPenaltyCount: value } }))} />
            <label className="toggle-row">
              <input type="checkbox" checked={state.ruleSet.allowDraw} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, allowDraw: event.target.checked } }))} />
              允许平局
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={state.ruleSet.enableOvertime} onChange={(event) => patchState((current) => ({ ...current, ruleSet: { ...current.ruleSet, enableOvertime: event.target.checked } }))} />
              启用加时
            </label>
          </section>
        )}

        {activeView === "results" && (
          <section className="panel results-panel">
            <div className="result-toolbar">
              <div>
                <h2>成绩导出</h2>
                <p>用于提交或归档比赛结果，不用于完整恢复现场状态。</p>
              </div>
              <div className="result-actions">
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
                <label className="file-button">
                  <FolderUp size={18} />
                  导入备份 JSON
                  <input type="file" accept=".json,application/json" onChange={(event) => handleBackupImport(event.target.files?.[0] ?? null)} />
                </label>
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
                      <td>{getWinnerLabel(match.winner, match)}</td>
                      <td>{getEndReasonLabel(match.endReason)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function viewTitle(view: ViewKey) {
  const titles: Record<ViewKey, string> = {
    import: "导入场次",
    matches: "比赛场次",
    console: "比赛控制台",
    rules: "规则配置",
    results: "结果导出",
  };
  return titles[view];
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

function FighterPanel(props: {
  side: "red" | "blue";
  match: Match;
  onScore: (side: "red" | "blue", delta: number) => void;
  onPenalty: (side: "red" | "blue") => void;
}) {
  const fighter = props.side === "red" ? props.match.red : props.match.blue;
  const score = props.side === "red" ? props.match.redScore : props.match.blueScore;
  const penalties = props.side === "red" ? props.match.redPenalties : props.match.bluePenalties;
  const sideLabel = props.side === "red" ? "红方" : "蓝方";

  return (
    <div className={`fighter-panel ${props.side}`}>
      <span>{sideLabel}</span>
      <h2>{fighter.name}</h2>
      <p>{fighter.club || "未填写单位"}</p>
      <strong>{score}</strong>
      <div className="score-actions">
        <button onClick={() => props.onScore(props.side, 1)}>+1</button>
        <button onClick={() => props.onScore(props.side, -1)}>-1</button>
      </div>
      <button className="penalty-btn" onClick={() => props.onPenalty(props.side)}>
        <ShieldAlert size={18} />
        处罚 {penalties}
      </button>
    </div>
  );
}

function NumberField(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="number" min={0} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
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
