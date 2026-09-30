// STREAMS API — 계약 전체는 docs/streams-api.md
//   POST /api/streams/start  { level, playerId? }          → { gameId, token, level, levelName, turn, card }
//   POST /api/streams/move   { token, slot, thinkMs? }       → { token, aiSlot, turn, playerScore, aiScore, nextCard | finished }
//   POST /api/streams/events { sessionId?, playerId?, events } → 202 { accepted }   (행동 기록, events.ts)
//   GET  /api/streams/stats · /api/streams/live(웹소켓)                              (실시간 통계, stats.ts)
// 요청 헤더 x-streams-client (예: web/1, unity-webgl/0.1.0) 는 streams_games.client 에 남는다 (client.ts).
// 게임 상태(덱 포함)는 암호화 토큰(state.ts)으로 클라이언트가 들고 다니고, 클라이언트는 지금 카드 한 장만 본다.
// 응답을 먼저 보내고 D1 기록은 waitUntil 로 뒤에서 쓴다 — 수마다 DB 왕복을 기다리지 않는다.
// 뒤에서 쓰는 기록은 순서가 뒤바뀌어도 되게: 턴 기록은 INSERT 만, 게임 결과는 끝날 때 한 번.
// 관리자 설정 streams/collect 가 false 면 게임은 그대로 되지만 D1 기록·실시간 집계를 남기지 않는다 (판 단위: 토큰의 rec).

import { LEVELS, PolicyNet, StreamsAI, type Level, type ManifestEntry } from "./ai.ts";
import { clientOf } from "./client.ts";
import { insertEvents, parseEvents } from "./events.ts";
import type { StatsHub } from "./statshub.ts";
import { N, newDeck, score } from "./game.ts";
import { open, seal, type GameState } from "./state.ts";
import { setting } from "../settings.ts";

export interface Env {
  DB: D1Database;
  MODELS: KVNamespace;
  STREAMS_KEY: string;
  STATS: DurableObjectNamespace<StatsHub>;
}

/** 실시간 통계는 한 곳(DO 하나)에 모은다 */
const hub = (env: Env) => env.STATS.get(env.STATS.idFromName("global"));

const AI_MODEL = "v17-pikl";
let aiPromise: Promise<StreamsAI> | null = null;

function loadAI(env: Env): Promise<StreamsAI> {
  aiPromise ??= (async () => {
    // 가중치는 바뀌지 않으므로 엣지 캐시를 길게 (기본 60초면 새 isolate 마다 원본에서 다시 받음)
    const cacheTtl = 86400;
    const [manifest, human, sgaz] = await Promise.all([
      env.MODELS.get<Record<string, ManifestEntry[]>>("streams/manifest.json", { type: "json", cacheTtl }),
      env.MODELS.get("streams/human_bc.bin", { type: "arrayBuffer", cacheTtl }),
      env.MODELS.get("streams/sgaz_d.bin", { type: "arrayBuffer", cacheTtl }),
    ]);
    if (!manifest || !human || !sgaz) throw new Error("model files missing in KV");
    return new StreamsAI(new PolicyNet(human, manifest.human_bc), new PolicyNet(sgaz, manifest.sgaz_d));
  })().catch((e) => {
    aiPromise = null;
    throw e;
  });
  return aiPromise;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const randomId = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

function background(ctx: ExecutionContext, write: Promise<unknown>) {
  ctx.waitUntil(write.catch((e) => console.error("streams db write failed", e)));
}

const collecting = (env: Env) => setting(env.DB, "streams", "collect", true);

async function start(req: Request, env: Env, ctx: ExecutionContext) {
  const body = (await req.json().catch(() => ({}))) as { level?: number; playerId?: string };
  const level = Number(body.level) as Level;
  if (!(level in LEVELS)) return json({ error: "level must be 1~5" }, 400);
  const playerId = typeof body.playerId === "string" ? body.playerId.slice(0, 64) : null;
  const state: GameState = { id: randomId(12), level, deck: newDeck(), pb: Array(N).fill(0), ab: Array(N).fill(0), turn: 0 };
  if (await collecting(env)) {
    const empty = JSON.stringify(state.pb);
    // token 컬럼은 서버 상태 방식일 때 쓰던 것 — 이제 비워 둔다
    background(ctx, env.DB.prepare(
      `INSERT INTO streams_games (id, token, player_id, level, ai_model, deck, player_board, ai_board, client, created_at)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(state.id, playerId, level, AI_MODEL, JSON.stringify(state.deck), empty, empty, clientOf(req), new Date().toISOString()).run());
    background(ctx, hub(env).started(state.id, clientOf(req)));
  } else {
    state.rec = false;
  }
  return json({ gameId: state.id, token: await seal(state, env.STREAMS_KEY), level, levelName: LEVELS[level].name, turn: 0, card: state.deck[0] });
}

async function move(req: Request, env: Env, ctx: ExecutionContext) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; slot?: number; thinkMs?: number };
  const g = await open(String(body.token ?? ""), env.STREAMS_KEY);
  if (!g) return json({ error: "game not found" }, 404);
  if (g.turn >= N) return json({ error: "game finished" }, 409);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= N || g.pb[slot] !== 0) return json({ error: "invalid slot" }, 400);

  const card = g.deck[g.turn];
  const t0 = Date.now();
  const ai = await loadAI(env);
  const aiMs = Date.now() - t0;
  const aiSlot = ai.choose(g.ab, card, g.level as Level);
  const next: GameState = { ...g, pb: [...g.pb], ab: [...g.ab], turn: g.turn + 1 };
  next.pb[slot] = card;
  next.ab[aiSlot] = card;
  const finished = next.turn === N;
  const ps = score(next.pb), as = score(next.ab);
  const thinkMs = Number.isFinite(body.thinkMs) ? Math.max(0, Math.round(body.thinkMs!)) : null;

  if (g.rec !== false) record(env, ctx, req, g, next, card, slot, aiSlot, thinkMs);

  const res = json({
    token: await seal(next, env.STREAMS_KEY), aiSlot, turn: next.turn, playerScore: ps, aiScore: as,
    ...(finished ? { finished: true } : { nextCard: g.deck[next.turn] }),
  });
  res.headers.set("server-timing", `model;dur=${aiMs}`);
  return res;
}

/** 한 수를 D1 과 실시간 집계에 남긴다 (응답 뒤에) */
function record(env: Env, ctx: ExecutionContext, req: Request, g: GameState, next: GameState, card: number, slot: number, aiSlot: number, thinkMs: number | null) {
  const finished = next.turn === N;
  const ps = score(next.pb), as = score(next.ab), now = new Date().toISOString();
  // 옛 토큰으로 같은 턴을 다시 두면 처음 기록을 유지하고 attempts 만 올린다 (분석에서 제외용)
  const writes = [env.DB.prepare(
    `INSERT INTO streams_turns (game_id, turn, card, player_slot, ai_slot, think_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id, turn) DO UPDATE SET attempts = attempts + 1`,
  ).bind(g.id, g.turn, card, slot, aiSlot, thinkMs, now)];
  if (finished) {
    writes.push(env.DB.prepare(
      `UPDATE streams_games SET player_board = ?, ai_board = ?, turn = ?, status = 'finished',
         player_score = ?, ai_score = ?, finished_at = ? WHERE id = ? AND status = 'playing'`,
    ).bind(JSON.stringify(next.pb), JSON.stringify(next.ab), N, ps, as, now, g.id));
  }
  background(ctx, env.DB.batch(writes));
  // 실시간 통계: 첫 수(어느 칸에 먼저 두나)와 판 결과만. 옛 토큰으로 다시 보낸 수는 허브가 판 id 로 걸러 낸다
  if (g.turn === 0) background(ctx, hub(env).first(g.id, card, slot, clientOf(req)));
  if (finished) background(ctx, hub(env).finished({ id: g.id, level: g.level, me: ps, ai: as, client: clientOf(req) }));
}

async function events(req: Request, env: Env, ctx: ExecutionContext) {
  const batch = parseEvents(await req.json().catch(() => null));
  if (typeof batch === "string") return json({ error: batch }, 400);
  if (!(await collecting(env))) return json({ accepted: 0 }, 202);
  if (batch.rows.length > 0) background(ctx, env.DB.batch(insertEvents(env.DB, batch, clientOf(req), new Date().toISOString())));
  return json({ accepted: batch.rows.length }, 202);
}

export async function handleStreams(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (req.method === "GET" && path === "/api/streams/live") return hub(env).fetch(req);
  if (req.method === "GET" && path === "/api/streams/stats") {
    const res = json(await hub(env).snapshot());
    res.headers.set("cache-control", "public, max-age=5");
    return res;
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (path === "/api/streams/start") return start(req, env, ctx);
  if (path === "/api/streams/move") return move(req, env, ctx);
  if (path === "/api/streams/events") return events(req, env, ctx);
  return json({ error: "not found" }, 404);
}
