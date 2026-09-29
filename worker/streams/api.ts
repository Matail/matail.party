// STREAMS API
//   POST /api/streams/start  { level, playerId? }            → { gameId, token, level, levelName, turn, card }
//   POST /api/streams/move   { gameId, token, slot, thinkMs? } → { aiSlot, turn, playerScore, aiScore, nextCard | finished }
// 덱은 D1 에만 있고 클라이언트에는 지금 카드 한 장만 보낸다. 사람과 AI는 같은 카드를 각자 보드에 놓는다.

import { LEVELS, PolicyNet, StreamsAI, type Level, type ManifestEntry } from "./ai.ts";
import { N, newDeck, score } from "./game.ts";

export interface Env {
  DB: D1Database;
  MODELS: KVNamespace;
}

const AI_MODEL = "v17-pikl";
let aiPromise: Promise<StreamsAI> | null = null;

function loadAI(env: Env): Promise<StreamsAI> {
  aiPromise ??= (async () => {
    const [manifest, human, sgaz] = await Promise.all([
      env.MODELS.get<Record<string, ManifestEntry[]>>("streams/manifest.json", "json"),
      env.MODELS.get("streams/human_bc.bin", "arrayBuffer"),
      env.MODELS.get("streams/sgaz_d.bin", "arrayBuffer"),
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

async function start(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as { level?: number; playerId?: string };
  const level = Number(body.level) as Level;
  if (!(level in LEVELS)) return json({ error: "level must be 1~5" }, 400);
  const playerId = typeof body.playerId === "string" ? body.playerId.slice(0, 64) : null;
  const id = randomId(12), token = randomId(16), deck = newDeck(), empty = JSON.stringify(Array(N).fill(0));
  await env.DB.prepare(
    `INSERT INTO streams_games (id, token, player_id, level, ai_model, deck, player_board, ai_board, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, token, playerId, level, AI_MODEL, JSON.stringify(deck), empty, empty, new Date().toISOString()).run();
  return json({ gameId: id, token, level, levelName: LEVELS[level].name, turn: 0, card: deck[0] });
}

async function move(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as { gameId?: string; token?: string; slot?: number; thinkMs?: number };
  const g = await env.DB.prepare("SELECT * FROM streams_games WHERE id = ?").bind(String(body.gameId ?? "")).first<{
    token: string; level: Level; deck: string; player_board: string; ai_board: string; turn: number; status: string;
  }>();
  if (!g || g.token !== body.token) return json({ error: "game not found" }, 404);
  if (g.status !== "playing") return json({ error: "game finished" }, 409);
  const deck: number[] = JSON.parse(g.deck), pb: number[] = JSON.parse(g.player_board), ab: number[] = JSON.parse(g.ai_board);
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= N || pb[slot] !== 0) return json({ error: "invalid slot" }, 400);

  const card = deck[g.turn];
  const aiSlot = (await loadAI(env)).choose(ab, card, g.level);
  pb[slot] = card;
  ab[aiSlot] = card;
  const turn = g.turn + 1, finished = turn === N;
  const ps = score(pb), as = score(ab), now = new Date().toISOString();
  const thinkMs = Number.isFinite(body.thinkMs) ? Math.max(0, Math.round(body.thinkMs!)) : null;

  // turn 조건으로 동시에 들어온 같은 수를 막는다
  const upd = await env.DB.prepare(
    `UPDATE streams_games SET player_board = ?, ai_board = ?, turn = ?, status = ?,
       player_score = ?, ai_score = ?, finished_at = ? WHERE id = ? AND turn = ?`,
  ).bind(JSON.stringify(pb), JSON.stringify(ab), turn, finished ? "finished" : "playing",
    ps, as, finished ? now : null, body.gameId, g.turn).run();
  if (!upd.meta.changes) return json({ error: "conflict" }, 409);
  await env.DB.prepare(
    "INSERT INTO streams_turns (game_id, turn, card, player_slot, ai_slot, think_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(body.gameId, g.turn, card, slot, aiSlot, thinkMs, now).run();

  return json({ aiSlot, turn, playerScore: ps, aiScore: as, ...(finished ? { finished: true } : { nextCard: deck[turn] }) });
}

export async function handleStreams(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (path === "/api/streams/start") return start(req, env);
  if (path === "/api/streams/move") return move(req, env);
  return json({ error: "not found" }, 404);
}
