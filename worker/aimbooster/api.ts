// AIMBOOSTER API — 계약 전체는 docs/aimbooster-api.md
//   POST /api/aimbooster/start   { playerId?, seed? }   → { runId, token, seed, rulesVersion }
//   POST /api/aimbooster/finish  { token, summary }     → { runId, counted, suspect, reasons, survivalTop, accuracyTop, runs }
//   GET  /api/aimbooster/rank?durationMs=&hits=&shots=  → { survivalTop, accuracyTop, runs }   (기록하지 않고 상위 % 만)
//   GET  /api/aimbooster/stats · /api/aimbooster/live(웹소켓)                                 (공개 집계, stats.ts)
// 판정은 Unity 가 하고, 서버는 끝난 판 요약이 규칙상 가능한지 검사한다 (validate.ts). 의심 판도 기록은 남긴다.
// 시작 시각은 토큰(token.ts)에 봉인돼 있어 "실제로 흐른 시간보다 오래 버텼다" 를 잡는다.
// 응답을 먼저 보내고 D1 기록은 waitUntil 로 뒤에서 쓴다. 관리자 설정 aimbooster/collect 가 false 면 기록 · 집계를 남기지 않는다.
import { clientOf } from "../streams/client.ts";
import { setting } from "../settings.ts";
import { RULES_VERSION } from "./rules.ts";
import type { AimStatsHub } from "./statshub.ts";
import { open, seal, type RunToken } from "./token.ts";
import { check, parseSummary, percentile } from "./validate.ts";

export interface Env {
  DB: D1Database;
  AIMBOOSTER_KEY: string;
  AIM_STATS: DurableObjectNamespace<AimStatsHub>;
}

export const CLIENT_HEADER = "x-aimbooster-client";

const hub = (env: Env) => env.AIM_STATS.get(env.AIM_STATS.idFromName("global"));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const randomId = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

function background(ctx: ExecutionContext, write: Promise<unknown>) {
  ctx.waitUntil(write.catch((e) => console.error("aimbooster db write failed", e)));
}

const collecting = (env: Env) => setting(env.DB, "aimbooster", "collect", true);

async function start(req: Request, env: Env, ctx: ExecutionContext) {
  const body = (await req.json().catch(() => ({}))) as { playerId?: unknown; seed?: unknown };
  const playerId = typeof body.playerId === "string" ? body.playerId.slice(0, 64) : null;
  const seed = Number.isInteger(body.seed) && (body.seed as number) >= 0 && (body.seed as number) <= 0xffffffff
    ? (body.seed as number)
    : crypto.getRandomValues(new Uint32Array(1))[0];
  const t: RunToken = { id: randomId(12), seed, at: Date.now(), rv: RULES_VERSION };
  const client = clientOf(req, CLIENT_HEADER);
  if (await collecting(env)) {
    background(ctx, env.DB.prepare(
      `INSERT INTO aim_runs (id, player_id, client, seed, rules_version, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(t.id, playerId, client, seed, RULES_VERSION, new Date(t.at).toISOString()).run());
    background(ctx, hub(env).started(t.id, client));
  } else {
    t.rec = false;
  }
  return json({ runId: t.id, token: await seal(t, env.AIMBOOSTER_KEY), seed, rulesVersion: RULES_VERSION });
}

async function finish(req: Request, env: Env, ctx: ExecutionContext) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; summary?: unknown };
  const t = await open(String(body.token ?? ""), env.AIMBOOSTER_KEY);
  if (!t) return json({ error: "run not found" }, 404);
  const s = parseSummary(body.summary);
  if (typeof s === "string") return json({ error: s }, 400);

  const now = Date.now();
  const reasons = check(s, now - t.at);
  if (s.seed !== t.seed) reasons.push("seed");
  const suspect = reasons.length > 0;
  const med = s.hits > 0 ? percentile(s.reactionsMs, 0.5) : null;
  const client = clientOf(req, CLIENT_HEADER);
  const rec = t.rec !== false;

  // 상위 % 는 나를 더하기 전 분포로. 의심 판은 분포에 더하지 않고 순위도 주지 않는다
  const r = await hub(env).finished(
    { id: t.id, durationMs: s.durationMs, hits: s.hits, shots: s.shots, reactionMedianMs: med }, client, rec && !suspect);
  if (r.duplicate) return json({ error: "run finished" }, 409);

  if (rec) {
    background(ctx, env.DB.prepare(
      `UPDATE aim_runs SET status = 'finished', duration_ms = ?, shots = ?, hits = ?, misses = ?, spawned = ?, max_level = ?,
         reaction_med_ms = ?, reaction_p90_ms = ?, summary = ?, suspect = ?, suspect_reasons = ?, finished_at = ?
       WHERE id = ? AND status = 'playing'`,
    ).bind(s.durationMs, s.shots, s.hits, s.misses, s.spawned, s.maxLevel, med, s.hits > 0 ? percentile(s.reactionsMs, 0.9) : null,
      JSON.stringify(s), suspect ? 1 : 0, suspect ? JSON.stringify(reasons) : null, new Date(now).toISOString(), t.id).run());
  }
  return json({
    runId: t.id, counted: rec && !suspect && !(client ?? "").startsWith("unity-editor/"), suspect, reasons,
    survivalTop: suspect ? null : r.survivalTop, accuracyTop: suspect ? null : r.accuracyTop, runs: r.runs,
  });
}

async function rankOnly(url: URL, env: Env) {
  const n = (k: string) => Number(url.searchParams.get(k));
  const durationMs = n("durationMs"), hits = n("hits"), shots = n("shots");
  if (![durationMs, hits, shots].every((v) => Number.isInteger(v) && v >= 0)) return json({ error: "durationMs, hits, shots required" }, 400);
  return json(await hub(env).rank(durationMs, hits, shots));
}

export async function handleAimbooster(req: Request, env: Env, ctx: ExecutionContext, path: string): Promise<Response> {
  if (req.method === "GET") {
    if (path === "/api/aimbooster/live") return hub(env).fetch(req);
    if (path === "/api/aimbooster/stats") {
      const res = json(await hub(env).snapshot());
      res.headers.set("cache-control", "public, max-age=5");
      return res;
    }
    if (path === "/api/aimbooster/rank") return rankOnly(new URL(req.url), env);
    return json({ error: "not found" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (path === "/api/aimbooster/start") return start(req, env, ctx);
  if (path === "/api/aimbooster/finish") return finish(req, env, ctx);
  return json({ error: "not found" }, 404);
}
