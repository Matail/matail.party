// 게임 상태 토큰: AES-GCM 으로 암호화해 클라이언트가 들고 다닌다.
// 클라이언트는 덱(앞으로 나올 카드)을 읽거나 상태를 고칠 수 없다. 키는 Worker 비밀값 STREAMS_KEY (32바이트 base64).

export type GameState = {
  id: string;
  level: number;
  deck: number[];
  pb: number[]; // 사람 보드
  ab: number[]; // AI 보드
  turn: number; // 놓은 카드 수
};

let keyPromise: Promise<CryptoKey> | null = null;

function key(secret: string): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey("raw", b64decode(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
  return keyPromise;
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

export async function seal(state: GameState, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify(state))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** 위조·손상된 토큰이면 null */
export async function open(token: string, secret: string): Promise<GameState | null> {
  try {
    const raw = b64decode(token);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await key(secret), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
