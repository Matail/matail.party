// 멀티 방을 실제 서버에 붙여 끝까지 돌려 본다 (room.ts 규칙 + roomdo.ts DO + api.ts 라우트).
//   npx wrangler dev   (다른 창에서. dist/ 가 없으면 빈 폴더라도 만든다)
//   node worker/streams/room.e2e.mjs [http://127.0.0.1:8787]
// 20초 시간 초과를 기다리므로 40초쯤 걸린다. 방 만들기 속도 제한(1분 5개)을 쓰므로 연달아 돌리면 1분 기다린다.
import assert from "node:assert/strict";
import http from "node:http";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function post(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-streams-client": "test/1" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

function conn(code, token, label) {
  const ws = new WebSocket(`${WS}/api/streams/rooms/${code}/ws`);
  const c = { ws, label, msgs: [], seen: [], closed: null, waiters: [] };
  ws.onmessage = (e) => {
    const m = e.data === "pong" ? { t: "pong" } : JSON.parse(e.data);
    c.msgs.push(m); c.seen.push(m);
    c.waiters = c.waiters.filter((w) => !w(m));
  };
  ws.onclose = (e) => { c.closed = e.code; c.waiters = c.waiters.filter((w) => !w({ t: "__close", code: e.code })); };
  c.open = new Promise((r) => (ws.onopen = r));
  c.send = (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
  /** 이미 받은 것 포함, pred 맞는 첫 메시지 (받은 뒤로는 그 앞까지 버림) */
  c.wait = (pred, ms = 5000) => new Promise((res, rej) => {
    const i = c.msgs.findIndex(pred);
    if (i >= 0) return res(c.msgs.splice(0, i + 1).pop());
    const t = setTimeout(() => rej(new Error(`${label}: timeout waiting ${pred} recent=${JSON.stringify(c.seen.slice(-6))}`)), ms);
    c.waiters.push((m) => {
      if (!pred(m)) return false;
      clearTimeout(t);
      c.msgs.length = 0;
      res(m);
      return true;
    });
  });
  c.waitClose = (ms = 8000) => c.closed !== null ? Promise.resolve(c.closed) : c.wait((m) => m.t === "__close", ms).then((m) => m.code);
  if (token) c.open.then(() => c.send({ t: "hello", seatToken: token }));
  return c;
}

const firstEmpty = (board) => board.indexOf(0);

// ── HTTP ──
const A = await post("/api/streams/rooms", { name: "  에이 ", playerId: "pidA" });
assert.equal(A.status, 201, JSON.stringify(A));
const code = A.body.code;
assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
log("room", code);
const B = await post(`/api/streams/rooms/${code.toLowerCase()}/join`, { name: "비" });
assert.equal(B.status, 200);
assert.equal(B.body.seat, 1);
const C = await post(`/api/streams/rooms/${code}/join`, { name: "씨" });
assert.equal(C.body.seat, 2);
assert.equal((await post(`/api/streams/rooms/${code}/join`, { name: "" })).status, 400);
assert.equal((await post(`/api/streams/rooms/ZZZZZZ/join`, { name: "x" })).body.error, "room not found");
assert.equal((await post(`/api/streams/rooms/ab/join`, { name: "x" })).status, 404);
log("http ok");

// ── Origin ──
const originStatus = (origin) => new Promise((res) => {
  const u = new URL(`${BASE}/api/streams/rooms/${code}/ws`);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: {
    Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", Origin: origin } });
  req.on("upgrade", (r, sock) => { sock.destroy(); res(101); });
  req.on("response", (r) => res(r.statusCode));
  req.end();
});
assert.equal(await originStatus("https://evil.example"), 403);
assert.equal(await originStatus("http://localhost:5173"), 101);
log("origin ok");

// ── hello 오류 ──
const bad = conn(code, "nope", "bad");
assert.equal(await bad.waitClose(), 4001);
const gone = conn("ZZZZZZ", "whatever", "gone");
assert.equal(await gone.waitClose(), 4004);
const silent = conn(code, null, "silent");
await new Promise((r) => setTimeout(r, 6500)); // hello 5초 마감. 알람에서 닫은 연결은 로컬(wrangler dev)에서 클라이언트가 CLOSING 에 머물러 readyState 로 본다
log("silent readyState", silent.ws.readyState, "close", silent.closed);
assert.ok(silent.ws.readyState >= 2);
log("hello errors ok");

// ── 연결 · 대기실 ──
const ca = conn(code, A.body.seatToken, "A");
const cb = conn(code, B.body.seatToken, "B");
let cc = conn(code, C.body.seatToken, "C");
const all3 = (m) => m.t === "state" && m.seats.length === 3 && m.seats.every((s) => s.online);
await Promise.all([ca, cb, cc].map((c) => c.wait(all3)));
ca.send("ping");
await ca.wait((m) => m.t === "pong");
log("lobby ok, ping ok");

cb.send({ t: "start" });
assert.equal((await cb.wait((m) => m.t === "error")).code, "not_host");
ca.send({ t: "start" });
const boards = { A: Array(20).fill(0), B: Array(20).fill(0), C: Array(20).fill(0) };
const players = { A: ca, B: cb, C: cc };
let card = await ca.wait((m) => m.t === "card");
assert.equal(card.turn, 0);
assert.equal(card.timeLeftMs, 20000);
log("started");

for (let turn = 0; turn < 20; turn++) {
  if (turn > 0) card = await ca.wait((m) => m.t === "card" && m.turn === turn);
  await new Promise((r) => setTimeout(r, 150)); // 연결당 초당 10개 제한 안에서
  const placeAs = (who) => {
    const slot = firstEmpty(boards[who]);
    players[who].send({ t: "place", turn, slot, thinkMs: 500 });
  };
  placeAs("A");
  placeAs("B");
  if (turn === 5) {
    // C 가 끊겼다가 다시 붙는다 → state 로 복구 후 둔다
    cc.ws.close();
    await ca.wait((m) => m.t === "state" && m.seats[2].online === false);
    cc = players.C = conn(code, C.body.seatToken, "C2");
    const s = await cc.wait((m) => m.t === "state");
    assert.equal(s.phase, "playing");
    assert.equal(s.turn, 5);
    assert.equal(s.card, card.card);
    assert.equal(s.mySlot, -1);
    assert.equal(s.you, 2);
    assert.ok(s.timeLeftMs > 0 && s.timeLeftMs <= 20000);
    assert.equal(s.seats[0].placed, true);
    placeAs("C");
    log("reconnect ok");
  } else if (turn === 10) {
    // C 가 안 둔다 → 20초 뒤 AI 가 대신
    log("waiting for timeout…");
  } else {
    placeAs("C");
  }
  const rev = await ca.wait((m) => m.t === "reveal" && m.turn === turn, 26000);
  assert.equal(rev.card, card.card);
  for (const s of rev.seats) boards["ABC"[s.seat]][s.slot] = card.card;
  assert.deepEqual(rev.seats.map((s) => s.auto), [false, false, turn === 10]);
  if (turn === 10) log("timeout auto ok");
}
const fin = await ca.wait((m) => m.t === "finished");
log("finished", JSON.stringify(fin.seats));
assert.equal(fin.seats.length, 3);

// ── 같은 자리 다른 탭 → 옛 연결 4000 ──
const ca2 = conn(code, A.body.seatToken, "A2");
assert.equal(await ca.waitClose(), 4000);
const s2 = await ca2.wait((m) => m.t === "state");
assert.equal(s2.phase, "finished");
assert.ok(s2.seats.every((s) => s.rank > 0));
assert.ok(s2.seats.every((s) => s.online));
log("replace ok");

// ── 방 만들기 속도 제한 (이미 1개) ──
const statuses = [];
for (let i = 0; i < 6; i++) statuses.push((await post("/api/streams/rooms", { name: `r${i}` })).status);
log("create statuses", statuses.join(","));
assert.ok(statuses.includes(429));

for (const c of [ca2, cb, cc]) c.ws.close();
log("ALL OK");
process.exit(0);
