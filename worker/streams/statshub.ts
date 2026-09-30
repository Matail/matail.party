// 실시간 통계 Durable Object — 집계(stats.ts)를 저장하고 웹소켓으로 방송한다.
// 보는 사람이 가만히 있으면 하이버네이션 API 로 잠들어 비용이 들지 않는다.
import { DurableObject } from "cloudflare:workers";
import { ALL_CARDS, applyFinished, applyFirst, applyStarted, countFromD1, counted, PUBLIC_CARDS, publicView, type Finished, type PublicCard, type PublicStats, type Stats } from "./stats.ts";

export class StatsHub extends DurableObject<{ DB: D1Database }> {
  private stats: Stats | null = null;
  private lastSent = 0;
  private cards: PublicCard[] | null = null;

  /** 공개할 카드 (관리자 설정 streams/public_cards, migration 0006). 없거나 못 읽으면 전부 */
  private async publicCards(): Promise<PublicCard[]> {
    if (this.cards) return this.cards;
    let cards: PublicCard[] = ALL_CARDS;
    try {
      const row = await this.env.DB.prepare(`SELECT value FROM site_settings WHERE game = 'streams' AND key = 'public_cards'`).first<{ value: string }>();
      if (row) cards = (JSON.parse(row.value) as string[]).filter((c): c is PublicCard => c in PUBLIC_CARDS);
    } catch (e) {
      console.error("public_cards read failed", e);
    }
    return (this.cards = cards);
  }

  private async load(): Promise<Stats> {
    this.stats ??= (await this.ctx.storage.get<Stats>("stats")) ?? (await countFromD1(this.env.DB, Date.now()));
    return this.stats;
  }

  private async changed() {
    await this.publicCards();
    await this.ctx.storage.put("stats", this.stats);
    const now = Date.now();
    if (now - this.lastSent >= 1000) this.broadcast(now);
    else if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(this.lastSent + 1000);
  }

  private broadcast(now: number) {
    this.lastSent = now;
    const msg = JSON.stringify(publicView(this.stats!, now, this.cards ?? ALL_CARDS));
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* 이미 닫힌 연결 */ }
    }
  }

  async alarm() {
    await this.load();
    await this.publicCards();
    this.broadcast(Date.now());
  }

  async started(gameId: string, client: string | null) {
    if (!counted(client)) return;
    applyStarted(await this.load(), gameId, Date.now());
    await this.changed();
  }

  async first(gameId: string, card: number, slot: number, client: string | null) {
    if (!counted(client)) return;
    applyFirst(await this.load(), card, slot, gameId);
    await this.changed();
  }

  async finished(g: Finished) {
    if (!counted(g.client)) return;
    applyFinished(await this.load(), g, Date.now());
    await this.changed();
  }

  async snapshot(): Promise<PublicStats> {
    return publicView(await this.load(), Date.now(), await this.publicCards());
  }

  /** 관리자가 공개 카드를 바꾼 뒤 부른다 — 다시 읽고 보는 사람들에게 바로 방송한다 */
  async reloadSettings(): Promise<PublicStats> {
    this.cards = null;
    await this.load();
    await this.publicCards();
    this.broadcast(Date.now());
    return this.snapshot();
  }

  /** 저장된 집계를 버리고 D1 에서 다시 센다 (집계 방식을 바꾼 뒤 등) */
  async recount(): Promise<PublicStats> {
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
