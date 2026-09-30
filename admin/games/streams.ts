// The STREAMS+ 관리자 모듈 — 공개 페이지(/stats/streams/)에 없는 것들. 보는 사람이 적어 D1 을 바로 읽는다.
//   통계: 데이터 품질 · 행동 기록 · 생각 시간 · 클라이언트 · 최근 끝난 판   (필터: 기간 · 난이도 · 클라이언트)
//   내보내기: 판 · 턴 · 행동 기록 · 학습용 판 · 학습용 턴
//   설정: 데이터 수집 켜기/끄기 · 공개 통계 카드      정리: 에디터 테스트 판 지우기
// 클라이언트를 고르지 않으면 에디터 테스트 판(unity-editor/…)은 통계에서 뺀다 — 품질 규칙(migration 0005)과 같다.
import type { Block, Filter, GameAdmin } from "./types.ts";

const KIND = (col: string) => `CASE WHEN instr(${col}, '/') > 0 THEN substr(${col}, 1, instr(${col}, '/') - 1) ELSE 'unknown' END`;
const EDITOR = "unity-editor/%";

/** 판(streams_games 모양, 별칭 a)에 거는 조건. stats=true 면 클라이언트를 고르지 않았을 때 에디터 판을 뺀다 */
export function gameWhere(f: Filter, a = "g", stats = true): { sql: string; binds: unknown[] } {
  const c: string[] = [], binds: unknown[] = [];
  if (f.from) { c.push(`${a}.created_at >= ?`); binds.push(f.from); }
  if (f.to) { c.push(`${a}.created_at < ?`); binds.push(f.to); }
  if (f.level) { c.push(`${a}.level = ?`); binds.push(f.level); }
  if (f.client) { c.push(`${KIND(`${a}.client`)} = ?`); binds.push(f.client); }
  else if (stats) c.push(`(${a}.client IS NULL OR ${a}.client NOT LIKE '${EDITOR}')`);
  return { sql: c.length ? c.join(" AND ") : "1 = 1", binds };
}

/** 행동 기록(별칭 e)에 거는 조건 — 기간과 클라이언트만 (행동 기록엔 난이도가 없다) */
export function eventWhere(f: Filter, stats = true): { sql: string; binds: unknown[] } {
  const c: string[] = [], binds: unknown[] = [];
  if (f.from) { c.push(`e.created_at >= ?`); binds.push(f.from); }
  if (f.to) { c.push(`e.created_at < ?`); binds.push(f.to); }
  if (f.client) { c.push(`${KIND("e.client")} = ?`); binds.push(f.client); }
  else if (stats) c.push(`(e.client IS NULL OR e.client NOT LIKE '${EDITOR}')`);
  return { sql: c.length ? c.join(" AND ") : "1 = 1", binds };
}

// 생각 시간 구간 (초). 마지막은 10분 넘음 또는 기록 없음 (= 품질 규칙의 slow_turn)
export const THINK_BUCKETS = ["1초 미만", "1~2초", "2~3초", "3~5초", "5~10초", "10~30초", "30~60초", "1~10분", "10분 넘음·없음"];
const THINK_CASE = `CASE
  WHEN t.think_ms IS NULL OR t.think_ms > 600000 THEN 8
  WHEN t.think_ms < 1000 THEN 0 WHEN t.think_ms < 2000 THEN 1 WHEN t.think_ms < 3000 THEN 2
  WHEN t.think_ms < 5000 THEN 3 WHEN t.think_ms < 10000 THEN 4 WHEN t.think_ms < 30000 THEN 5
  WHEN t.think_ms < 60000 THEN 6 ELSE 7 END`;

const LEVELS = ["입문", "보통", "숙련", "고수", "마스터"];
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("ko-KR");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

type Row = Record<string, number | string | null>;

async function overview(db: D1Database, f: Filter): Promise<Block[]> {
  const g = gameWhere(f), all = gameWhere(f, "g", false), e = eventWhere(f);
  const q = (sql: string, binds: unknown[]) => db.prepare(sql).bind(...binds);
  // 학습용 뷰(streams_clean_games)도 같은 조건으로 — 별칭 c
  const c = gameWhere(f, "c", false);
  const [quality, clean, retried, short, recent, clients, events, hover, sessions, think] = await db.batch<Row>([
    q(`SELECT count(*) AS games, coalesce(sum(g.status = 'finished'), 0) AS finished,
         coalesce(sum(g.client LIKE '${EDITOR}'), 0) AS editor, coalesce(sum(g.mode <> 'ai'), 0) AS pvp
       FROM streams_games g WHERE ${all.sql}`, all.binds),
    q(`SELECT count(*) AS n FROM streams_clean_games c WHERE ${c.sql}`, c.binds),
    q(`SELECT count(DISTINCT t.game_id) AS n FROM streams_turns t JOIN streams_games g ON g.id = t.game_id WHERE t.attempts > 1 AND ${all.sql}`, all.binds),
    q(`SELECT count(*) AS n FROM streams_games g WHERE g.status = 'finished' AND ${all.sql}
         AND (SELECT count(*) FROM streams_turns t WHERE t.game_id = g.id) < 20`, all.binds),
    q(`SELECT g.level, g.player_score AS me, g.ai_score AS ai, g.client, g.created_at, g.finished_at
       FROM streams_games g WHERE g.mode = 'ai' AND g.status = 'finished' AND ${g.sql} ORDER BY g.finished_at DESC LIMIT 30`, g.binds),
    q(`SELECT ${KIND("g.client")} AS kind, count(*) AS games, round(avg(g.player_score), 1) AS avg_me,
         coalesce(sum(g.player_score > g.ai_score), 0) AS won
       FROM streams_games g WHERE g.mode = 'ai' AND g.status = 'finished' AND ${g.sql} GROUP BY kind ORDER BY games DESC`, g.binds),
    q(`SELECT e.type, count(*) AS n FROM streams_events e WHERE ${e.sql} GROUP BY e.type ORDER BY n DESC`, e.binds),
    q(`SELECT count(*) AS n, round(avg(json_extract(e.data, '$.ms'))) AS avg_ms, count(DISTINCT e.game_id) AS games
       FROM streams_events e WHERE e.type = 'hover' AND ${e.sql}`, e.binds),
    q(`SELECT count(*) AS n, round(avg(span) / 1000) AS avg_sec, round(avg(events), 1) AS avg_events FROM (
         SELECT max(e.client_ts) - min(e.client_ts) AS span, count(*) AS events
         FROM streams_events e WHERE e.session_id IS NOT NULL AND ${e.sql} GROUP BY e.session_id)`, e.binds),
    q(`SELECT ${THINK_CASE} AS bucket, count(*) AS n FROM streams_clean_turns t JOIN streams_clean_games c ON c.id = t.game_id
       WHERE ${c.sql} GROUP BY bucket`, c.binds),
  ]);

  const qa = quality.results[0] ?? {};
  const games = Number(qa.games ?? 0), finished = Number(qa.finished ?? 0), nClean = Number(clean.results[0]?.n ?? 0);
  const ev = Object.fromEntries(events.results.map((r) => [String(r.type), Number(r.n)]));
  // 시작·끝 (행동 지표의 분모) — 통계 조건(에디터 제외)으로
  const started = await db.prepare(`SELECT count(*) AS started, coalesce(sum(g.status = 'finished'), 0) AS finished
    FROM streams_games g WHERE g.mode = 'ai' AND ${g.sql}`).bind(...g.binds).first<Row>();
  const st = { started: Number(started?.started ?? 0), finished: Number(started?.finished ?? 0) };
  const hv = hover.results[0] ?? {}, ss = sessions.results[0] ?? {};
  const thinkHist = Array(THINK_BUCKETS.length).fill(0);
  for (const r of think.results) thinkHist[Number(r.bucket)] = Number(r.n);
  const tSum = thinkHist.reduce((a, b) => a + b, 0);
  const types = Object.entries(ev).sort((a, b) => b[1] - a[1]);

  return [
    {
      kind: "tiles",
      items: [
        { label: "학습용 판", value: fmt(nClean), sub: `끝난 판 ${fmt(finished)} 중 ${pct(nClean, finished)}%` },
        { label: "시작한 판", value: fmt(st.started), sub: `끝까지 ${pct(st.finished, st.started)}%` },
        { label: "포기율", value: `${pct(ev.abandon ?? 0, st.started)}%`, sub: `포기 ${fmt(ev.abandon)}판` },
        { label: "재대전율", value: `${pct(ev.rematch ?? 0, st.finished)}%`, sub: `한 판 더 ${fmt(ev.rematch)}번` },
        { label: "세션", value: fmt(ss.n), sub: `평균 ${Math.round(Number(ss.avg_sec ?? 0) / 60)}분 · 기록 ${Number(ss.avg_events ?? 0)}개` },
      ],
    },
    {
      kind: "bars",
      title: "데이터 품질",
      note: "학습에 넣는 판(streams_clean_games)과 규칙으로 빠진 판. 한 판이 여러 이유로 빠질 수 있어요. 에디터 판도 셉니다.",
      max: games,
      rows: [
        { label: "학습용", value: nClean, text: fmt(nClean) },
        { label: "에디터·로컬", value: Number(qa.editor ?? 0), text: fmt(qa.editor), warn: true },
        { label: "다시 둔 턴", value: Number(retried.results[0]?.n ?? 0), text: fmt(retried.results[0]?.n), warn: true },
        { label: "20턴 미만 끝", value: Number(short.results[0]?.n ?? 0), text: fmt(short.results[0]?.n), warn: true },
        { label: "AI 대전 아님", value: Number(qa.pvp ?? 0), text: fmt(qa.pvp), warn: true },
        { label: "끝나지 않음", value: games - finished, text: fmt(games - finished), warn: true },
      ],
    },
    {
      kind: "bars",
      title: "행동 기록",
      note: `난이도 조건은 적용되지 않아요. 망설임 ${fmt(hv.n)}번 · 평균 ${(Number(hv.avg_ms ?? 0) / 1000).toFixed(1)}초 · 판당 ${
        Number(hv.games) ? (Number(hv.n) / Number(hv.games)).toFixed(1) : "–"}번`,
      rows: types.map(([t, n]) => ({ label: t, value: n, text: fmt(n) })),
    },
    {
      kind: "bars",
      title: "생각 시간",
      note: "학습용 턴(streams_clean_turns)의 카드를 보고 놓기까지 걸린 시간. 빨간 칸은 품질 규칙의 느린 턴.",
      rows: THINK_BUCKETS.map((l, i) => ({ label: l, value: thinkHist[i], text: `${fmt(thinkHist[i])} · ${pct(thinkHist[i], tSum)}%`, warn: i === THINK_BUCKETS.length - 1 })),
    },
    {
      kind: "table",
      title: "클라이언트",
      note: "끝난 AI 대전.",
      columns: [{ label: "클라이언트" }, { label: "판", num: true }, { label: "평균 점수", num: true }, { label: "사람 승률", num: true }],
      rows: clients.results.map((r) => [String(r.kind), fmt(r.games), Number(r.avg_me), `${pct(Number(r.won), Number(r.games))}%`]),
    },
    {
      kind: "table",
      title: "최근 끝난 판",
      note: "최근 30판. 누가 뒀는지(player_id)는 여기 보여 주지 않아요 (내보내기에는 익명 id 가 들어가요).",
      wide: true,
      columns: [{ label: "끝난 시각(KST)" }, { label: "난이도" }, { label: "사람", num: true }, { label: "AI", num: true }, { label: "결과" }, { label: "걸린 시간", num: true }, { label: "클라이언트" }],
      rows: recent.results.map((r) => {
        const me = Number(r.me), ai = Number(r.ai);
        const sec = Math.round((Date.parse(String(r.finished_at)) - Date.parse(String(r.created_at))) / 1000);
        return [kst(String(r.finished_at)), LEVELS[Number(r.level) - 1] ?? "-", me, ai, me > ai ? "사람 승" : me < ai ? "AI 승" : "무",
          `${Math.floor(sec / 60)}분 ${sec % 60}초`, r.client ? String(r.client) : "헤더 없음"];
      }),
    },
  ];
}

export const streams: GameAdmin = {
  id: "streams",
  title: "The STREAMS+",
  levels: LEVELS,

  async clients(db) {
    const { results } = await db.prepare(`SELECT DISTINCT ${KIND("client")} AS kind FROM streams_games ORDER BY kind`).all<{ kind: string }>();
    return results.map((r) => r.kind);
  },

  overview: (db, f) => overview(db, f),

  datasets: [
    {
      id: "games", label: "판 (원본 전체)", note: "끝나지 않은 판·에디터 판까지 전부. clean 열이 1 이면 학습용 판.",
      jsonColumns: ["deck", "player_board", "ai_board"],
      query(db, f, limit) {
        const w = gameWhere(f, "g", false);
        return db.prepare(`SELECT g.id, g.player_id, g.level, g.ai_model, g.mode, g.client, g.status, g.turn, g.player_score, g.ai_score,
            g.deck, g.player_board, g.ai_board, g.created_at, g.finished_at, (g.id IN (SELECT id FROM streams_clean_games)) AS clean
          FROM streams_games g WHERE ${w.sql} ORDER BY g.created_at LIMIT ?`).bind(...w.binds, limit);
      },
    },
    {
      id: "turns", label: "턴 (원본 전체)", note: "한 수마다 한 줄. attempts > 1 은 옛 토큰으로 다시 둔 턴.",
      query(db, f, limit) {
        const w = gameWhere(f, "g", false);
        return db.prepare(`SELECT t.game_id, t.turn, t.card, t.player_slot, t.ai_slot, t.think_ms, t.attempts, g.level, g.client, t.created_at
          FROM streams_turns t JOIN streams_games g ON g.id = t.game_id WHERE ${w.sql} ORDER BY g.created_at, t.game_id, t.turn LIMIT ?`).bind(...w.binds, limit);
      },
    },
    {
      id: "events", label: "행동 기록", note: "망설임·포기·재대전·세션. 난이도 조건은 적용되지 않아요.",
      jsonColumns: ["data"],
      query(db, f, limit) {
        const w = eventWhere(f, false);
        return db.prepare(`SELECT e.session_id, e.player_id, e.game_id, e.seq, e.type, e.data, e.client, e.client_ts, e.created_at
          FROM streams_events e WHERE ${w.sql} ORDER BY e.created_at, e.session_id, e.seq LIMIT ?`).bind(...w.binds, limit);
      },
    },
    {
      id: "clean_games", label: "학습용 판", note: "품질 규칙을 통과한 판 (streams_clean_games).",
      jsonColumns: ["deck", "player_board", "ai_board"],
      query(db, f, limit) {
        const w = gameWhere(f, "c", false);
        return db.prepare(`SELECT * FROM streams_clean_games c WHERE ${w.sql} ORDER BY c.created_at LIMIT ?`).bind(...w.binds, limit);
      },
    },
    {
      id: "clean_turns", label: "학습용 턴", note: "학습용 판의 턴 (streams_clean_turns). slow_turn 은 표시만.",
      query(db, f, limit) {
        const w = gameWhere(f, "c", false);
        return db.prepare(`SELECT t.* FROM streams_clean_turns t JOIN streams_clean_games c ON c.id = t.game_id
          WHERE ${w.sql} ORDER BY c.created_at, t.game_id, t.turn LIMIT ?`).bind(...w.binds, limit);
      },
    },
  ],

  settings: [
    { key: "collect", type: "toggle", default: true, label: "데이터 수집",
      note: "끄면 게임은 그대로 되지만 판·턴·행동 기록과 실시간 집계를 남기지 않아요. 최대 30초 뒤 적용 (이미 시작한 판은 시작할 때 설정을 따라요)." },
    { key: "public_cards", type: "multi", default: ["tiles", "funnel", "bins", "radar", "gauge", "heat"], label: "공개 통계 카드",
      note: "/stats/streams/ 에 보일 카드. 끈 카드의 숫자는 공개 응답에서도 빠져요.",
      options: [
        { id: "tiles", label: "요약 칸 (두는 중·오늘·전체)" },
        { id: "funnel", label: "판 흐름" },
        { id: "bins", label: "점수 분포" },
        { id: "radar", label: "난이도별 사람 vs AI" },
        { id: "gauge", label: "승·무·패" },
        { id: "heat", label: "첫 카드 자리" },
      ] },
  ],

  async onSaved(env, key) {
    if (key !== "public_cards") return;
    if (!env.STATS) return "실시간 통계에 알리지 못했어요 (STATS 바인딩 없음) — 공개 페이지엔 통계 서버가 다시 뜰 때 반영돼요.";
    try {
      const stub = env.STATS.get(env.STATS.idFromName("global")) as unknown as { reloadSettings(): Promise<unknown> };
      await stub.reloadSettings();
    } catch (e) {
      return `실시간 통계에 알리지 못했어요 (${(e as Error).message}) — 공개 페이지엔 통계 서버가 다시 뜰 때 반영돼요.`;
    }
  },

  cleanup: {
    label: "에디터 테스트 기록",
    note: "Unity 에디터에서 둔 판(client unity-editor/…)과 그 턴, 에디터에서 보낸 행동 기록. 통계·학습에는 원래 안 들어가요. 지운 기록은 되살릴 수 없어요.",
    backup: { dataset: "games", filter: { client: "unity-editor" } },
    async preview(db) {
      const [g, t, e] = await db.batch<{ n: number }>([
        db.prepare(`SELECT count(*) AS n FROM streams_games WHERE client LIKE '${EDITOR}'`),
        db.prepare(`SELECT count(*) AS n FROM streams_turns WHERE game_id IN (SELECT id FROM streams_games WHERE client LIKE '${EDITOR}')`),
        db.prepare(`SELECT count(*) AS n FROM streams_events WHERE client LIKE '${EDITOR}'`),
      ]);
      return [
        { label: "판", count: Number(g.results[0]?.n ?? 0) },
        { label: "턴", count: Number(t.results[0]?.n ?? 0) },
        { label: "행동 기록", count: Number(e.results[0]?.n ?? 0) },
      ];
    },
    async run(db) {
      const [t, e, g] = await db.batch([
        db.prepare(`DELETE FROM streams_turns WHERE game_id IN (SELECT id FROM streams_games WHERE client LIKE '${EDITOR}')`),
        db.prepare(`DELETE FROM streams_events WHERE client LIKE '${EDITOR}'`),
        db.prepare(`DELETE FROM streams_games WHERE client LIKE '${EDITOR}'`),
      ]);
      return [
        { label: "판", count: g.meta.changes },
        { label: "턴", count: t.meta.changes },
        { label: "행동 기록", count: e.meta.changes },
      ];
    },
  },
};
