// STREAMS 관리자 통계 Worker (streams-admin) — 공개 사이트(my-site)와 따로 배포한다.
// workers.dev 주소 전체를 Cloudflare Access 로 막고, 여기서도 Access 토큰을 확인한다 (설정이 없으면 닫힌다).
//   GET /              관리자 페이지
//   GET /api/overview  관리자 통계 JSON (queries.ts)
// 배포: npx wrangler deploy -c admin/wrangler.jsonc   (설정 방법은 docs/streams-admin.md)
import { accessKeys, verifyAccess } from "./access.ts";
import { PAGE } from "./page.ts";
import { overview } from "./queries.ts";

interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string; // 예: myteam.cloudflareaccess.com
  ACCESS_AUD: string;         // Access 앱의 Application Audience (AUD) 태그
}

const denied = (why: string) =>
  new Response(`403 — ${why}\n\nCloudflare Access 로 로그인해야 볼 수 있어요. 설정: docs/streams-admin.md`, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return denied("Access 설정(ACCESS_TEAM_DOMAIN · ACCESS_AUD)이 없어 닫혀 있어요");
    let who: string | null = null;
    try {
      who = await verifyAccess(req.headers.get("cf-access-jwt-assertion"), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, await accessKeys(env.ACCESS_TEAM_DOMAIN));
    } catch (e) {
      console.error("access check failed", e);
    }
    if (!who) return denied("Access 토큰이 없거나 맞지 않아요");

    const path = new URL(req.url).pathname;
    const headers = { "cache-control": "no-store", "x-robots-tag": "noindex" };
    if (path === "/") return new Response(PAGE, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
    if (path === "/api/overview") {
      return new Response(JSON.stringify({ viewer: who, ...(await overview(env.DB, Date.now())) }), {
        headers: { ...headers, "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404, headers });
  },
} satisfies ExportedHandler<Env>;
