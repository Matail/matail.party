// 관리자 전용 통계 — 공개 페이지(/games/streams/live/)에 없는 것들. 보는 사람이 적어 D1 을 바로 읽는다.
//   · 최근 판 (시각·걸린 시간·클라이언트)        · 클라이언트별 판 수·평균 점수
//   · 행동 기록 (망설임·포기·재대전·세션)          · 생각 시간 분포
//   · 품질 규칙으로 빠진 판 (에디터·다시 둔 턴·20턴 미만·pvp)

const DAY = 86400_000;
const OK = `g.mode = 'ai' AND (g.client IS NULL OR g.client NOT LIKE 'unity-editor/%')`;
const EV_OK = `(e.client IS NULL OR e.client NOT LIKE 'unity-editor/%')`;
const KIND = (col: string) => `CASE WHEN instr(${col}, '/') > 0 THEN substr(${col}, 1, instr(${col}, '/') - 1) ELSE 'unknown' END`;

// 생각 시간 구간 (초). 마지막은 10분 넘음 또는 기록 없음 (= 품질 규칙의 slow_turn)
export const THINK_BUCKETS = ["1초 미만", "1~2초", "2~3초", "3~5초", "5~10초", "10~30초", "30~60초", "1~10분", "10분 넘음·없음"];
const THINK_CASE = `CASE
  WHEN t.think_ms IS NULL OR t.think_ms > 600000 THEN 8
  WHEN t.think_ms < 1000 THEN 0 WHEN t.think_ms < 2000 THEN 1 WHEN t.think_ms < 3000 THEN 2
  WHEN t.think_ms < 5000 THEN 3 WHEN t.think_ms < 10000 THEN 4 WHEN t.think_ms < 30000 THEN 5
  WHEN t.think_ms < 60000 THEN 6 ELSE 7 END`;

export async function overview(db: D1Database, now: number, days = 7) {
  const since = new Date(now - days * DAY).toISOString();
  const month = new Date(now - 30 * DAY).toISOString();
  type Row = Record<string, number | string | null>;
  const [quality, clean, retried, short, recent, clients, events, hover, sessions, started, think] = await db.batch<Row>([
    db.prepare(`SELECT count(*) AS games, coalesce(sum(status = 'finished'), 0) AS finished,
                  coalesce(sum(client LIKE 'unity-editor/%'), 0) AS editor, coalesce(sum(mode <> 'ai'), 0) AS pvp
                FROM streams_games`),
    db.prepare(`SELECT count(*) AS n FROM streams_clean_games`),
    db.prepare(`SELECT count(DISTINCT game_id) AS n FROM streams_turns WHERE attempts > 1`),
    db.prepare(`SELECT count(*) AS n FROM streams_games g WHERE g.status = 'finished'
                  AND (SELECT count(*) FROM streams_turns t WHERE t.game_id = g.id) < 20`),
    db.prepare(`SELECT g.level, g.player_score AS me, g.ai_score AS ai, g.client, g.created_at, g.finished_at
                FROM streams_games g WHERE ${OK} AND g.status = 'finished' ORDER BY g.finished_at DESC LIMIT 30`),
    db.prepare(`SELECT ${KIND("g.client")} AS kind, count(*) AS games, round(avg(g.player_score), 1) AS avg_me,
                  coalesce(sum(g.player_score > g.ai_score), 0) AS won
                FROM streams_games g WHERE ${OK} AND g.status = 'finished' AND g.created_at >= ? GROUP BY kind ORDER BY games DESC`).bind(month),
    db.prepare(`SELECT e.type, count(*) AS n FROM streams_events e WHERE ${EV_OK} AND e.created_at >= ? GROUP BY e.type ORDER BY n DESC`).bind(since),
    db.prepare(`SELECT count(*) AS n, round(avg(json_extract(e.data, '$.ms'))) AS avg_ms, count(DISTINCT e.game_id) AS games
                FROM streams_events e WHERE ${EV_OK} AND e.type = 'hover' AND e.created_at >= ?`).bind(since),
    db.prepare(`SELECT count(*) AS n, round(avg(span) / 1000) AS avg_sec, round(avg(events), 1) AS avg_events FROM (
                  SELECT max(e.client_ts) - min(e.client_ts) AS span, count(*) AS events
                  FROM streams_events e WHERE ${EV_OK} AND e.created_at >= ? AND e.session_id IS NOT NULL GROUP BY e.session_id)`).bind(since),
    db.prepare(`SELECT count(*) AS started, coalesce(sum(g.status = 'finished'), 0) AS finished
                FROM streams_games g WHERE ${OK} AND g.created_at >= ?`).bind(since),
    db.prepare(`SELECT ${THINK_CASE} AS bucket, count(*) AS n FROM streams_clean_turns t GROUP BY bucket`),
  ]);

  const q = quality.results[0] ?? {};
  const ev = Object.fromEntries(events.results.map((r) => [String(r.type), Number(r.n)]));
  const st = started.results[0] ?? {};
  const thinkHist = Array(THINK_BUCKETS.length).fill(0);
  for (const r of think.results) thinkHist[Number(r.bucket)] = Number(r.n);

  return {
    generatedAt: now,
    days,
    quality: {
      games: Number(q.games ?? 0),
      finished: Number(q.finished ?? 0),
      clean: Number(clean.results[0]?.n ?? 0),
      excluded: {
        editor: Number(q.editor ?? 0),
        retried: Number(retried.results[0]?.n ?? 0),
        short: Number(short.results[0]?.n ?? 0),
        pvp: Number(q.pvp ?? 0),
      },
    },
    recent: recent.results.map((r) => ({
      level: Number(r.level), me: Number(r.me), ai: Number(r.ai), client: r.client as string | null,
      finishedAt: String(r.finished_at),
      seconds: Math.round((Date.parse(String(r.finished_at)) - Date.parse(String(r.created_at))) / 1000),
    })),
    clients: clients.results.map((r) => ({ kind: String(r.kind), games: Number(r.games), avgMe: Number(r.avg_me), won: Number(r.won) })),
    behavior: {
      started: Number(st.started ?? 0),
      finished: Number(st.finished ?? 0),
      events: ev,
      hover: { count: Number(hover.results[0]?.n ?? 0), avgMs: Number(hover.results[0]?.avg_ms ?? 0), games: Number(hover.results[0]?.games ?? 0) },
      sessions: { count: Number(sessions.results[0]?.n ?? 0), avgSec: Number(sessions.results[0]?.avg_sec ?? 0), avgEvents: Number(sessions.results[0]?.avg_events ?? 0) },
    },
    think: { buckets: THINK_BUCKETS, counts: thinkHist },
  };
}
