// my-site Worker: /api/* 만 처리하고 나머지는 정적 파일(dist/)로 넘긴다.
import { handleStreams, type Env as StreamsEnv } from "./streams/api.ts";

interface Env extends StreamsEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/streams/")) {
      try {
        return await handleStreams(req, env, path);
      } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: "server error" }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
