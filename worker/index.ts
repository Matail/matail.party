// my-site Worker: /api/* 만 처리하고 나머지는 정적 파일(dist/)로 넘긴다.
import { handleStreams, type Env as StreamsEnv } from "./streams/api.ts";
import { preflight, withCors } from "./streams/client.ts";

// 실시간 통계 Durable Object (wrangler.jsonc 의 durable_objects)
export { StatsHub } from "./streams/statshub.ts";

interface Env extends StreamsEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
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
