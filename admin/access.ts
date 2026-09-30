// Cloudflare Access 가 붙여 주는 서명 토큰(Cf-Access-Jwt-Assertion) 확인.
// Access 가 이 Worker 앞을 막고 있더라도, Worker 도 직접 확인한다 — 설정이 빠지거나 풀리면 열리지 않고 닫힌다.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

let certs: { at: number; keys: Jwk[] } | null = null;

/** 팀 도메인의 공개 키 목록 (1시간 캐시) */
export async function accessKeys(teamDomain: string): Promise<Jwk[]> {
  if (certs && Date.now() - certs.at < 3600_000) return certs.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs ${res.status}`);
  certs = { at: Date.now(), keys: ((await res.json()) as { keys: Jwk[] }).keys };
  return certs.keys;
}

/** 토큰이 이 팀·이 앱(aud) 것이고, 서명이 맞고, 만료되지 않았으면 이메일(또는 sub). 아니면 null */
export async function verifyAccess(token: string | null, teamDomain: string, aud: string, keys: Jwk[], now = Date.now()): Promise<string | null> {
  if (!token || !teamDomain || !aud) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]) as { alg: string; kid: string };
    const claims = json(parts[1]) as { aud: string | string[]; iss: string; exp: number; nbf?: number; email?: string; sub?: string };
    if (header.alg !== "RS256") return null;
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
    if (claims.iss !== `https://${teamDomain}`) return null;
    const t = now / 1000;
    if (!(claims.exp > t) || (claims.nbf !== undefined && claims.nbf > t + 60)) return null;
    return claims.email ?? claims.sub ?? "unknown";
  } catch {
    return null;
  }
}
