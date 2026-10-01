// AIMBOOSTER 실시간 집계 Durable Object — 분포(stats.ts)를 저장하고 상위 % 를 답하고 웹소켓으로 방송한다.
// STREAMS StatsHub 와 같은 방식: 보는 사람이 가만히 있으면 하이버네이션 API 로 잠들어 비용이 들지 않는다.
import { DurableObject } from "cloudflare:workers";
import { applyFinished, applyStarted, countFromD1, counted, publicView, rank, seen, type AimStats, type Finished, type PublicAimStats, type Rank } from "./stats.ts";

export interface FinishResult extends Rank {
  duplicate: boolean;   // 이미 받은 판 (같은 토큰을 다시 보냄)
}

export class AimStatsHub extends DurableObject<{ DB: D1Database }> {
  private stats: AimStats | null = null;
  private lastSent = 0;

  private async load(): Promise<AimStats> {
    this.stats ??= (await this.ctx.storage.get<AimStats>("stats")) ?? (await countFromD1(this.env.DB, Date.now()));
    return this.stats;
  }

  private async changed() {
    await this.ctx.storage.put("stats", this.stats);
    const now = Date.now();
    if (now - this.lastSent >= 1000) this.broadcast(now);
    else if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(this.lastSent + 1000);
  }

  private broadcast(now: number) {
    this.lastSent = now;
    const msg = JSON.stringify(publicView(this.stats!, now));
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* 이미 닫힌 연결 */ }
    }
  }

  async alarm() {
    await this.load();
    this.broadcast(Date.now());
  }

  async started(id: string, client: string | null) {
    if (!counted(client)) return;
    applyStarted(await this.load(), id, Date.now());
    await this.changed();
  }

  /**
   * 끝난 판: 지금 분포에서의 상위 % 를 먼저 계산하고(나는 아직 빼고), 셀 판이면 분포에 더한다.
   * 의심 판 · 에디터 판 · 수집이 꺼진 판(count = false)은 더하지 않는다. 같은 판을 두 번 보내면 duplicate.
   */
  async finished(g: Finished, client: string | null, count: boolean): Promise<FinishResult> {
    const s = await this.load();
    if (seen(s, g.id)) return { ...rank(s, g.durationMs, g.hits, g.shots), duplicate: true };
    const r = rank(s, g.durationMs, g.hits, g.shots);
    if (count && counted(client)) applyFinished(s, g, Date.now());
    await this.changed();
    return { ...r, runs: s.finished, duplicate: false };
  }

  async rank(durationMs: number, hits: number, shots: number): Promise<Rank> {
    return rank(await this.load(), durationMs, hits, shots);
  }

  async snapshot(): Promise<PublicAimStats> {
    return publicView(await this.load(), Date.now());
  }

  /** 저장된 집계를 버리고 D1 에서 다시 센다 (집계 방식을 바꾼 뒤 등) */
  async recount(): Promise<PublicAimStats> {
    this.stats = await countFromD1(this.env.DB, Date.now());
    await this.changed();
    return this.snapshot();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(await this.snapshot()));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage() { /* 보는 쪽은 듣기만 한다 */ }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, "bye"); } catch { /* 이미 닫힘 */ }
  }
}
