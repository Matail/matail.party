// STREAMS API
//   POST /api/streams/start  { level, playerId? }          → { gameId, token, level, levelName, turn, card }
//   POST /api/streams/move   { token, slot, thinkMs? }       → { token, aiSlot, turn, playerScore, aiScore, nextCard | finished }
// 게임 상태(덱 포함)는 암호화 토큰(state.ts)으로 클라이언트가 들고 다니고, 클라이언트는 지금 카드 한 장만 본다.
// 응답을 먼저 보내고 D1 기록은 waitUntil 로 뒤에서 쓴다 — 수마다 DB 왕복을 기다리지 않는다.
// 뒤에서 쓰는 기록은 순서가 뒤바뀌어도 되게: 턴 기록은 INSERT 만, 게임 결과는 끝날 때 한 번.

import { LEVELS, PolicyNet, StreamsAI, type Level, type ManifestEntry } from "./ai.ts";
import { N, newDeck, score } from "./game.ts";
import { open, seal, type GameState } from "./state.ts";

export interface Env {
  DB: D1Database;
  MODELS: KVNamespace;
  STREAMS_KEY: string;
}

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

async function start(req: Request, env: Env, ctx: ExecutionContext) {
  const body = (await req.json().catch(() => ({}))) as { level?: number; playerId?: string };
  const level = Number(body.level) as Level;
  if (!(level in LEVELS)) return json({ error: "level must be 1~5" }, 400);
  const playerId = typeof body.playerId === "string" ? body.playerId.slice(0, 64) : null;
  const state: GameState = { id: randomId(12), level, deck: newDeck(), pb: Array(N).fill(0), ab: Array(N).fill(0), turn: 0 };
  const empty = JSON.stringify(state.pb);
  // token 컬럼은 서버 상태 방식일 때 쓰던 것 — 이제 비워 둔다
  background(ctx, env.DB.prepare(
    `INSERT INTO streams_games (id, token, player_id, level, ai_model, deck, player_board, ai_board, created_at)
     VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(state.id, playerId, level, AI_MODEL, JSON.stringify(state.deck), empty, empty, new Date().toISOString()).run());
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
  const ps = score(next.pb), as = score(next.ab), now = new Date().toISOString();
  const thinkMs = Number.isFinite(body.thinkMs) ? Math.max(0, Math.round(body.thinkMs!)) : null;

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

  const res = json({
    token: await seal(next, env.STREAMS_KEY), aiSlot, turn: next.turn, playerScore: ps, aiScore: as,
    ...(finished ? { finished: true } : { nextCard: g.deck[next.turn] }),
  });
  res.headers.set("server-timing", `model;dur=${aiMs}`);
  return res;
}

export async function handleStreams(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (path === "/api/streams/start") return start(req, env, ctx);
  if (path === "/api/streams/move") return move(req, env, ctx);
  return json({ error: "not found" }, 404);
}
