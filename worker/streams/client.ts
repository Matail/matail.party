// 어떤 클라이언트가 보낸 요청인지 (x-streams-client 헤더) 와 CORS.
//
// 헤더 형식: "<종류>/<버전>" — 예: web/1, unity-webgl/0.1.0, unity-editor/0.1.0
// 헤더가 없거나 형식이 틀려도 요청은 받는다 (캐시된 옛 웹 페이지). 그때 기록은 null.
//
// CORS: 사이트와 같은 도메인에서 도는 웹·Unity WebGL 은 필요 없다.
// Unity 의 "Build And Run" 이 띄우는 localhost 서버에서 테스트할 때만 허용한다.

const CLIENT_RE = /^[a-z][a-z0-9-]{0,31}\/[0-9A-Za-z.+-]{1,32}$/;

export function clientOf(req: Request): string | null {
  const v = req.headers.get("x-streams-client")?.trim() ?? "";
  return CLIENT_RE.test(v) ? v : null;
}

const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function corsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin || !LOCAL_RE.test(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-streams-client",
    "access-control-expose-headers": "server-timing",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/** OPTIONS 사전 요청 응답 */
export function preflight(req: Request): Response {
  const h = corsHeaders(req.headers.get("origin"));
  return new Response(null, { status: h ? 204 : 403, headers: h ?? {} });
}

/** 허용된 출처면 응답에 CORS 헤더를 붙인다 */
export function withCors(req: Request, res: Response): Response {
  const h = corsHeaders(req.headers.get("origin"));
  if (h) for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
  return res;
}
