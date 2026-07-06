import { downloadBlob } from "./download";
import { normalizeState } from "./storage";
import type { TournamentState } from "../types";

const BACKUP_VERSION = 1;

interface BackupPayload {
  app: "heima-record";
  version: number;
  exportedAt: string;
  state: TournamentState;
}

function assertBackupPayload(value: unknown): asserts value is BackupPayload {
  if (!value || typeof value !== "object") {
    throw new Error("备份文件格式不正确。");
  }

  const payload = value as Partial<BackupPayload>;
  if (payload.app !== "heima-record" || !payload.state) {
    throw new Error("这不是 heima-record 的完整备份文件。");
  }

  if (!Array.isArray(payload.state.matches) || !payload.state.ruleSet) {
    throw new Error("备份文件缺少比赛数据或规则配置。");
  }
}

export function exportStateBackup(state: TournamentState) {
  const payload: BackupPayload = {
    app: "heima-record",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `heima-record-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function parseStateBackup(file: File): Promise<TournamentState> {
  const text = await file.text();
  const payload = JSON.parse(text) as unknown;
  assertBackupPayload(payload);

  // 恢复时更新时间戳，确保后续自动保存会覆盖当前浏览器本地状态。
  return {
    ...normalizeState(payload.state),
    updatedAt: new Date().toISOString(),
  };
}
