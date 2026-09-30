// my-site Worker: /api/* 만 처리하고 나머지는 정적 파일(dist/)로 넘긴다.
// 옛 주소(my-site.matail.workers.dev)로 온 페이지 요청은 대표 주소로 영구 이동시킨다.
import { handleStreams, type Env as StreamsEnv } from "./streams/api.ts";
import { preflight, withCors } from "./streams/client.ts";

// 실시간 통계 Durable Object (wrangler.jsonc 의 durable_objects)
export { StatsHub } from "./streams/statshub.ts";

// 대표 주소 (astro.config.mjs 의 SITE 와 같다)
const SITE = "https://matail.xyz";
const OLD_HOST = "my-site.matail.workers.dev";

interface Env extends StreamsEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    // 옛 링크 · 검색 결과를 새 주소로. /api 는 넘기지 않는다 — 캐시된 옛 페이지의 POST · 웹소켓이 깨진다.
    // 호스트를 정확히 비교한다 — 브랜치 미리보기(<버전>-my-site.matail.workers.dev)는 그대로 둬야 한다
    if (url.hostname === OLD_HOST && !path.startsWith("/api/")) {
      return Response.redirect(`${SITE}${path}${url.search}`, 301);
    }
    if (path.startsWith("/api/streams/")) {
      if (req.method === "OPTIONS") return preflight(req);
      let res: Response;
      try {
        res = await handleStreams(req, env, ctx, path);
      } catch (e) {
        console.error(e);
        res = new Response(JSON.stringify({ error: "server error" }), { status: 500, headers: { "content-type": "application/json" } });
      }
      // 웹소켓 업그레이드(101) 응답은 헤더를 바꿀 수 없고 CORS 도 필요 없다
      return res.status === 101 ? res : withCors(req, res);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
