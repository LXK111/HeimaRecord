import type { Match, SwissRoundStatus, TournamentEvent, TournamentPlayer } from "../types";

export type GroupStageGrouping = {
  kind: "group";
  groups: Array<{
    name: string;
    players: TournamentPlayer[];
  }>;
};

export type SwissGrouping = {
  kind: "swiss";
  rounds: Array<{
    roundNo: number;
    status: SwissRoundStatus;
    groups: Array<{
      name: string;
      matches: Match[];
    }>;
    byePlayer: TournamentPlayer | null;
  }>;
};

export type TournamentGroupingResults = GroupStageGrouping | SwissGrouping | { kind: "none" };

export function buildTournamentGroupingResults(event: TournamentEvent, matches: Match[]): TournamentGroupingResults {
  if (event.formatConfig.format === "group_bracket") {
    return {
      kind: "group",
      groups: event.groupNames.map((groupName) => ({
        name: groupName,
        players: event.players.filter((player) => player.groupName === groupName),
      })),
    };
  }

  if (event.formatConfig.format === "swiss_bracket") {
    const matchesById = new Map(matches.map((match) => [match.id, match]));
    const playersById = new Map(event.players.map((player) => [player.id, player]));
    return {
      kind: "swiss",
      rounds: [...event.swissRounds]
        .sort((a, b) => a.roundNo - b.roundNo)
        .map((round) => {
          const groups = new Map<string, Match[]>();
          // 使用每轮实际场次计算现场分组，确保人工调整分组或场地后结果立即同步。
          round.matchIds.forEach((matchId) => {
            const match = matchesById.get(matchId);
            if (!match) return;
            const groupName = match.groupName.trim() || "未分组";
            groups.set(groupName, [...(groups.get(groupName) ?? []), match]);
          });
          return {
            roundNo: round.roundNo,
            status: round.status,
            groups: Array.from(groups, ([name, groupedMatches]) => ({ name, matches: groupedMatches })),
            byePlayer: round.byePlayerId ? playersById.get(round.byePlayerId) ?? null : null,
          };
        }),
    };
  }

  return { kind: "none" };
}

export function hasGroupingResults(results: TournamentGroupingResults) {
  if (results.kind === "group") return results.groups.some((group) => group.players.length > 0);
  if (results.kind === "swiss") return results.rounds.some((round) => round.groups.length > 0 || round.byePlayer);
  return false;
}
