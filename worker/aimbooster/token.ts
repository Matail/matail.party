// 판 토큰: /start 가 봉인해 주고 /finish 가 연다. 클라이언트는 시작 시각을 바꾸거나 다른 판의 토큰을 만들 수 없다.
// AES-GCM, 키는 Worker 비밀값 AIMBOOSTER_KEY (32바이트 base64). STREAMS 토큰(state.ts)과 키를 나눠 쓴다 —
// state.ts 는 키를 하나만 캐시해서 같이 쓸 수 없다.

export type RunToken = {
  id: string;
  seed: number;
  at: number;      // /start 를 받은 서버 시각 (ms)
  rv: number;      // 규칙 버전
  rec?: false;     // 시작할 때 수집이 꺼져 있었다 — 이 판은 기록하지 않는다
};

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;

function key(secret: string): Promise<CryptoKey> {
  if (cached?.secret !== secret) cached = { secret, key: crypto.subtle.importKey("raw", b64decode(secret), "AES-GCM", false, ["encrypt", "decrypt"]) };
  return cached.key;
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function seal(t: RunToken, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify(t))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** 위조 · 손상된 토큰이면 null */
export async function open(token: string, secret: string): Promise<RunToken | null> {
  try {
    const raw = b64decode(token);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
