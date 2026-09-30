// access.ts 토큰 확인 — 로컬에서 만든 RSA 키로 서명한 토큰으로.
//   node admin/access.test.ts
import assert from "node:assert/strict";
import { verifyAccess, type Jwk } from "./access.ts";

const TEAM = "team.cloudflareaccess.com", AUD = "aud-123";
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pub = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
const keys: Jwk[] = [{ kid: "k1", kty: "RSA", n: pub.n!, e: pub.e! }];

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function token(claims: Record<string, unknown>, kid = "k1", key = pair.privateKey) {
  const head = enc({ alg: "RS256", kid, typ: "JWT" }), body = enc(claims);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}
const now = Date.now(), exp = Math.floor(now / 1000) + 600;
const good = { aud: [AUD], iss: `https://${TEAM}`, exp, email: "me@example.com" };

assert.equal(await verifyAccess(await token(good), TEAM, AUD, keys, now), "me@example.com");
assert.equal(await verifyAccess(null, TEAM, AUD, keys, now), null);                                   // 토큰 없음
assert.equal(await verifyAccess(await token(good), TEAM, "", keys, now), null);                       // 설정(aud) 없음 → 닫힘
assert.equal(await verifyAccess(await token({ ...good, aud: ["other"] }), TEAM, AUD, keys, now), null); // 다른 앱
assert.equal(await verifyAccess(await token({ ...good, iss: "https://evil.example" }), TEAM, AUD, keys, now), null);
assert.equal(await verifyAccess(await token({ ...good, exp: Math.floor(now / 1000) - 5 }), TEAM, AUD, keys, now), null); // 만료
assert.equal(await verifyAccess(await token(good, "k2"), TEAM, AUD, keys, now), null);                // 모르는 키
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
assert.equal(await verifyAccess(await token(good, "k1", other.privateKey), TEAM, AUD, keys, now), null); // 서명 위조
const t = await token(good);
assert.equal(await verifyAccess(t.slice(0, -4) + "AAAA", TEAM, AUD, keys, now), null);                // 서명 변조
assert.equal(await verifyAccess("not.a.jwt", TEAM, AUD, keys, now), null);

console.log("access.test: ok");
