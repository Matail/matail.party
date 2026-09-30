// 관리자 Worker (streams-admin) — 공개 사이트(my-site)와 따로 배포한다. 게임별 통계·설정·내보내기.
// workers.dev 주소 전체를 Cloudflare Access 로 막고, 여기서도 Access 토큰을 확인한다 (설정이 없으면 닫힌다).
//   GET  /                                 관리자 페이지
//   GET  /api/games                        게임 목록과 각 게임의 설정·내보내기 정의
//   GET  /api/g/<game>/overview?조건         통계 블록        조건: from · to (YYYY-MM-DD, 한국 날짜) · level · client
//   GET  /api/g/<game>/export/<data>.csv|json?조건
//   GET  /api/g/<game>/settings            PUT 으로 { key, value } 저장
//   GET  /api/g/<game>/cleanup             지울 테스트 기록 개수. POST 로 지운다
// 바꾸는 요청(PUT·POST)은 x-admin-action 헤더가 있어야 한다 — 다른 사이트의 폼이 로그인 쿠키로 보내는 요청을 막는다.
// 배포: npx wrangler deploy -c admin/wrangler.jsonc   (설정 방법은 docs/streams-admin.md)
import { accessKeys, verifyAccess } from "./access.ts";
import { fileName, parseFilter, toCsv, toJsonRows } from "./files.ts";
import { GAMES, gameById } from "./games/index.ts";
import type { AdminEnv } from "./games/types.ts";
import { PAGE } from "./page.ts";
import { checkSetting, readSettings, writeSetting } from "./settings.ts";

const EXPORT_LIMIT = 100_000;

const denied = (why: string) =>
  new Response(`403 — ${why}\n\nCloudflare Access 로 로그인해야 볼 수 있어요. 설정: docs/streams-admin.md`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: AdminEnv): Promise<Response> {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return denied("Access 설정(ACCESS_TEAM_DOMAIN · ACCESS_AUD)이 없어 닫혀 있어요");
    let who: string | null = null;
    try {
      who = await verifyAccess(req.headers.get("cf-access-jwt-assertion"), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, await accessKeys(env.ACCESS_TEAM_DOMAIN));
    } catch (e) {
      console.error("access check failed", e);
    }
    if (!who) return denied("Access 토큰이 없거나 맞지 않아요");

    const url = new URL(req.url), path = url.pathname;
    if (req.method !== "GET" && !req.headers.get("x-admin-action")) return json({ error: "x-admin-action header required" }, 400);
    if (path === "/") return new Response(PAGE, { headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" } });
    if (path === "/api/games") {
      return json({
        viewer: who,
        games: GAMES.map((g) => ({
          id: g.id, title: g.title, levels: g.levels, settings: g.settings,
          datasets: g.datasets.map((d) => ({ id: d.id, label: d.label, note: d.note })),
          cleanup: { label: g.cleanup.label, note: g.cleanup.note, backup: g.cleanup.backup },
        })),
      });
    }

    const m = path.match(/^\/api\/g\/([a-z0-9-]+)\/(overview|settings|cleanup|export\/([a-z_]+)\.(csv|json))$/);
    const game = m ? gameById(m[1]) : undefined;
    if (!m || !game) return json({ error: "not found" }, 404);
    const f = parseFilter(url.searchParams, game.levels.length);

    try {
      if (m[2] === "overview" && req.method === "GET") {
        const [blocks, clients] = await Promise.all([game.overview(env.DB, f, Date.now()), game.clients(env.DB)]);
        return json({ viewer: who, generatedAt: Date.now(), filter: f, clients, blocks });
      }

      if (m[3]) {
        const ds = game.datasets.find((d) => d.id === m[3]);
        if (!ds) return json({ error: "unknown dataset" }, 404);
        const { results } = await ds.query(env.DB, f, EXPORT_LIMIT + 1).all<Record<string, unknown>>();
        const truncated = results.length > EXPORT_LIMIT;
        const rows = truncated ? results.slice(0, EXPORT_LIMIT) : results;
        const csv = m[4] === "csv";
        const body = csv ? toCsv(rows) : JSON.stringify(toJsonRows(rows, ds.jsonColumns));
        const name = fileName(game.id, ds.id, url.searchParams, m[4]);
        return new Response(body, {
          headers: {
            ...NO_STORE,
            "content-type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${ds.id}.${m[4]}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            "x-rows": String(rows.length),
            ...(truncated ? { "x-truncated": String(EXPORT_LIMIT) } : {}),
          },
        });
      }

      if (m[2] === "settings") {
        if (req.method === "GET") return json({ values: await readSettings(env.DB, game.id, game.settings) });
        if (req.method === "PUT") {
          const body = (await req.json().catch(() => ({}))) as { key?: string; value?: unknown };
          const def = game.settings.find((d) => d.key === body.key);
          if (!def) return json({ error: "unknown setting" }, 400);
          const value = checkSetting(def, body.value);
          if (value === null) return json({ error: "bad value" }, 400);
          await writeSetting(env.DB, game.id, def.key, value, who);
          const warning = (await game.onSaved?.(env, def.key)) ?? null;
          return json({ values: await readSettings(env.DB, game.id, game.settings), warning });
        }
      }

      if (m[2] === "cleanup") {
        if (req.method === "GET") return json({ items: await game.cleanup.preview(env.DB) });
        if (req.method === "POST") {
          const deleted = await game.cleanup.run(env.DB);
          console.log("cleanup", game.id, who, JSON.stringify(deleted));
          return json({ deleted, items: await game.cleanup.preview(env.DB) });
        }
      }
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message }, 500);
    }
    return json({ error: "method not allowed" }, 405);
  },
} satisfies ExportedHandler<AdminEnv>;
