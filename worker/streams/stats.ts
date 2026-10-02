// 3단계 실시간 통계 (docs/streams-unity-plan.md) — 집계 계산. 저장·방송은 Durable Object StatsHub (statshub.ts).
// 집계는 DO 한 곳에 있고,
// 판이 시작·첫 수·끝날 때 갱신해 웹소켓으로 방송한다. 웹 트래픽은 D1 을 치지 않는다.
//   GET /api/streams/stats — 지금 스냅숏 (웹소켓이 안 될 때)
//   GET /api/streams/live  — 웹소켓. 접속하면 스냅숏을 받고, 바뀔 때마다 다시 받는다 (초당 최대 1번)
// 에디터·로컬 테스트 판(unity-editor/…)과 AI 대전이 아닌 판은 세지 않는다 — 품질 규칙(migration 0005)과 같다.
// 공개 데이터만 센다: 합계·분포뿐, 판 하나하나(최근 판·시각)와 클라이언트 비율은 관리자 전용(admin/)이다.
// player_id·game_id 는 밖으로 나가지 않는다.

export const LEVEL_COUNT = 5;
export const SLOTS = 20;
export const CARDS = 30;
export const BIN_WIDTH = 10;
export const BINS = 11;            // 0~9, 10~19, … 90~99, 100 이상
const ACTIVE_MS = 30 * 60 * 1000;  // 30분 넘게 끝나지 않은 판은 "두는 중" 에서 뺀다
const DAY_OFFSET_MS = 9 * 3600 * 1000; // 하루는 한국 시각 기준

export interface LevelAgg { games: number; won: number; drawn: number; me: number; ai: number }

export interface Stats {
  day: string;                     // 한국 날짜 YYYY-MM-DD
  started: number;
  finished: number;
  won: number;                     // 사람이 이긴 판
  drawn: number;
  best: number;
  todayStarted: number;
  todayFinished: number;
  todayBest: number;
  levels: LevelAgg[];              // [0] 이 입문(1)
  bins: number[];                  // 사람 점수 분포
  heat: number[];                  // 첫 수: (card-1)*SLOTS + slot
  active: Record<string, number>;  // 진행 중 game_id → 시작 시각 (밖으로 내보내지 않음)
  marks: string[];                 // 이미 센 첫 수·결과 ("f:<id>" · "e:<id>") — 옛 토큰으로 다시 보낸 수를 두 번 세지 않게 (밖으로 내보내지 않음)
}

export type PublicStats = Partial<Omit<Stats, "active" | "marks">> & { day: string; playing?: number; updatedAt: number; cards: PublicCard[] };

/** 공개 통계 페이지의 카드와 각 카드가 쓰는 값. 관리자 설정 streams/public_cards 로 켜고 끈다 */
export const PUBLIC_CARDS = {
  tiles: ["playing", "todayFinished", "todayBest", "best", "finished"],
  funnel: ["started", "finished", "won"],
  bins: ["bins", "levels", "finished"],
  radar: ["levels"],
  gauge: ["won", "drawn", "finished"],
  heat: ["heat"],
} as const;
export type PublicCard = keyof typeof PUBLIC_CARDS;
export const ALL_CARDS = Object.keys(PUBLIC_CARDS) as PublicCard[];

export const dayOf = (ms: number) => new Date(ms + DAY_OFFSET_MS).toISOString().slice(0, 10);

/** 한국 날짜 자정의 UTC ISO 문자열 (D1 created_at 비교용) */
export const dayStartIso = (ms: number) => new Date(Date.parse(dayOf(ms) + "T00:00:00Z") - DAY_OFFSET_MS).toISOString();

export const counted = (client: string | null, mode = "ai") => mode === "ai" && !(client ?? "").startsWith("unity-editor/");

export const binOf = (score: number) => Math.min(BINS - 1, Math.max(0, Math.floor(score / BIN_WIDTH)));

export function emptyStats(now: number): Stats {
  return {
    day: dayOf(now), started: 0, finished: 0, won: 0, drawn: 0, best: 0,
    todayStarted: 0, todayFinished: 0, todayBest: 0,
    levels: Array.from({ length: LEVEL_COUNT }, () => ({ games: 0, won: 0, drawn: 0, me: 0, ai: 0 })),
    bins: Array(BINS).fill(0), heat: Array(CARDS * SLOTS).fill(0), active: {}, marks: [],
  };
}

/** 날짜가 바뀌었으면 "오늘" 칸을 비운다 */
function rollDay(s: Stats, now: number) {
  const d = dayOf(now);
  if (d !== s.day) Object.assign(s, { day: d, todayStarted: 0, todayFinished: 0, todayBest: 0 });
}

export function applyStarted(s: Stats, gameId: string, now: number) {
  rollDay(s, now);
  s.started++;
  s.todayStarted++;
  s.active[gameId] = now;
}

const MARKS = 1000;

/** 처음 보는 표시면 기록하고 true */
function mark(s: Stats, key: string): boolean {
  if (s.marks.includes(key)) return false;
  s.marks.push(key);
  if (s.marks.length > MARKS) s.marks.splice(0, s.marks.length - MARKS);
  return true;
}

export function applyFirst(s: Stats, card: number, slot: number, gameId?: string) {
  if (gameId && !mark(s, `f:${gameId}`)) return;
  if (card >= 1 && card <= CARDS && slot >= 0 && slot < SLOTS) s.heat[(card - 1) * SLOTS + slot]++;
}

export type Finished = { id: string; level: number; me: number; ai: number; client: string | null };

/** 끝난 판 하나를 누적 칸에 더한다 (실시간 갱신과 D1 재계산이 같이 쓴다). 레벨이 틀리면 false */
function tally(s: Stats, g: Finished): boolean {
  const lv = s.levels[g.level - 1];
  if (!lv) return false;
  s.finished++;
  if (g.me > g.ai) { s.won++; lv.won++; }
  if (g.me === g.ai) { s.drawn++; lv.drawn++; }
  lv.games++;
  lv.me += g.me;
  lv.ai += g.ai;
  s.bins[binOf(g.me)]++;
  s.best = Math.max(s.best, g.me);
  return true;
}

export function applyFinished(s: Stats, g: Finished, now: number) {
  if (!mark(s, `e:${g.id}`)) return;
  rollDay(s, now);
  if (!tally(s, g)) return;
  s.todayFinished++;
  s.todayBest = Math.max(s.todayBest, g.me);
  delete s.active[g.id];
}

/** 밖으로 내보내는 모양: 진행 중 판 id 대신 개수만, 켜진 카드가 쓰는 값만 */
export function publicView(s: Stats, now: number, cards: readonly PublicCard[] = ALL_CARDS): PublicStats {
  for (const [id, t] of Object.entries(s.active)) if (now - t > ACTIVE_MS) delete s.active[id];
  const all: Record<string, unknown> = { ...s, playing: Object.keys(s.active).length };
  const out: Record<string, unknown> = { day: s.day, updatedAt: now, cards: [...cards] };
  for (const c of cards) for (const k of PUBLIC_CARDS[c] ?? []) out[k] = all[k];
  return out as PublicStats;
}

/** D1 원본에서 처음부터 다시 센다 (DO 가 처음 뜨거나 저장된 집계가 없을 때) */
export async function countFromD1(db: D1Database, now: number): Promise<Stats> {
  const s = emptyStats(now);
  const ok = `g.mode = 'ai' AND (g.client IS NULL OR g.client NOT LIKE 'unity-editor/%')`;
  type Row = Record<string, number | string | null>;
  const [totals, today, finished, heat] = await db.batch<Row>([
    db.prepare(`SELECT count(*) AS started FROM streams_games g WHERE ${ok}`),
    db.prepare(`SELECT count(*) AS started, coalesce(sum(g.status = 'finished'), 0) AS finished, coalesce(max(g.player_score), 0) AS best
                FROM streams_games g WHERE ${ok} AND g.created_at >= ?`).bind(dayStartIso(now)),
    db.prepare(`SELECT g.level, g.player_score AS me, g.ai_score AS ai FROM streams_games g WHERE ${ok} AND g.status = 'finished'`),
    db.prepare(`SELECT t.card, t.player_slot AS slot, count(*) AS n FROM streams_turns t JOIN streams_games g ON g.id = t.game_id
                WHERE t.turn = 0 AND ${ok} GROUP BY t.card, t.player_slot`),
  ]);
  s.started = Number(totals.results[0]?.started ?? 0);
  const d = today.results[0] ?? {};
  s.todayStarted = Number(d.started ?? 0);
  s.todayFinished = Number(d.finished ?? 0);
  s.todayBest = Number(d.best ?? 0);
  for (const r of finished.results) {
    tally(s, { id: "", level: Number(r.level), me: Number(r.me), ai: Number(r.ai), client: null });
  }
  for (const r of heat.results) {
    const card = Number(r.card), slot = Number(r.slot);
    if (card >= 1 && card <= CARDS && slot >= 0 && slot < SLOTS) s.heat[(card - 1) * SLOTS + slot] += Number(r.n);
  }
  return s;
}
