# STREAMS Unity 리빌딩 계획

웹 STREAMS 를 Unity 로 다시 만든다. 목표는 세 가지다.

1. **Unity 클라이언트** — 지금의 AI(v17-pikl)와 그대로 대전한다. AI 는 계속 업데이트한다.
2. **데이터 수집 + 실시간 웹 반영** — 플레이 기록을 모으고, 모인 결과를 사이트에 실시간으로 보여 준다.
3. **멀티플레이** — 나중에 플레이어끼리 같은 카드를 받아 겨룬다.

## 지금 있는 것 (출발점)

| 부분 | 위치 | 성질 |
|---|---|---|
| 규칙 | `worker/streams/game.ts` | 20칸, 40장 풀에서 20장, 비내림차순 구간 길이로 점수 (`SCORE_TABLE`) |
| AI | `worker/streams/ai.ts` | 사람 모방(human_bc) + SGAZ 정책망을 β 로 섞음. 난이도 5단계. 가중치는 KV `MODELS` (리포에 없음) |
| API | `worker/streams/api.ts` | `POST /api/streams/start`, `POST /api/streams/move`. 상태는 AES-GCM 토큰으로 클라이언트가 들고 다님 |
| 기록 | D1 `streams-records` (`migrations/`) | `streams_games`, `streams_turns` (think_ms, attempts) |
| 웹 클라이언트 | `public/games/streams/script.js` | 카드 한 장씩 받아 놓기만 함 |

**핵심 판단: 서버 권위(server-authoritative) 구조를 그대로 유지한다.**
덱과 AI 가 서버에만 있으니 Unity 클라이언트는 "화면 + 입력"만 새로 만들면 되고,
가중치가 새지 않고, 데이터 수집 경로도 하나로 모인다. 이 결정이 멀티플레이까지 이어진다.

## 전체 구조 (최종 모습)

```text
 Unity (WebGL · PC · 모바일)          웹 (Astro, my-site)
   │  HTTP: 싱글(AI 대전)                │  WebSocket: 실시간 통계 구독
   │  WebSocket: 멀티 방                 │
   ▼                                     ▼
 Cloudflare Worker ── /api/streams/*  (지금 있는 것 확장)
   ├─ AI 추론 (ai.ts, KV 가중치, 버전 관리)
   ├─ Durable Object  StatsHub   — 집계 + 웹소켓 방송 (실시간 웹 반영)
   ├─ Durable Object  Room       — 멀티 한 판 (덱·턴·타이머 권위)
   ├─ Durable Object  Lobby      — 매치메이킹
   └─ D1  streams-records        — 원본 기록 (학습 데이터)
                  │
                  ▼  주기적 내보내기
        streams-v17 (학습 리포) → 새 가중치 → KV 에 버전으로 올림
```

Cloudflare 안에서 끝낸다. 실시간 방송과 멀티 방 둘 다 Durable Object + 웹소켓(하이버네이션 API)으로 같은 방식이라
따로 게임 서버(Photon, Netcode 전용 서버 등)를 두지 않는다. STREAMS 는 **동시 턴제**(모두 같은 카드를 받고 각자 놓음)라
프레임 동기화가 필요 없고, 방 하나가 초당 몇 개의 메시지만 주고받는다. DO 하나로 충분하다.

---

## 0단계 — 준비: 계약 고정 (1주)

Unity 를 붙이기 전에 서버와 클라이언트 사이의 약속을 문서와 테스트로 못 박는다.

- **API 계약 문서화** (`docs/streams-api.md`): 요청·응답 JSON, 오류 코드, 토큰 규칙.
- **API 버전**: 요청 헤더 `x-streams-client: unity-webgl/0.1.0` 같은 식으로 클라이언트 종류·버전을 받는다.
  지금 웹 클라이언트도 `web/1` 을 보내게 고친다. (1단계부터 데이터에 클라이언트 구분이 필요하다.)
- **규칙 테스트 벡터**: `game.ts` 의 `score()` 결과를 JSON 으로 뽑아 두고(보드 → 점수 수백 개),
  C# 이식본이 같은 값을 내는지 Unity 테스트에서 확인한다. `ai.test.ts` 가 파이썬↔TS 를 맞춘 것과 같은 방식.
- **CORS**: WebGL 빌드를 사이트와 같은 도메인에 올리면 필요 없다. PC·모바일 빌드는 브라우저가 아니라 필요 없다.
  에디터·다른 도메인 테스트용으로 `/api/streams/*` 에 허용 출처 목록만 둔다.

## 1단계 — Unity 싱글플레이 (AI 대전) (3~4주)

### 프로젝트

- **Unity 6 LTS**, 리포는 **따로** 만든다 (`streams-unity`). Unity 프로젝트는 크고(Library, 에셋) 빌드 흐름이 달라
  이 사이트 리포에 넣지 않는다. 빌드 결과(WebGL)만 사이트로 가져온다.
- 대상: **WebGL 먼저** (사이트 `/games/streams/` 에 바로 올림) → PC → 모바일(Android/iOS).

### 코드 구조

```text
Assets/Scripts/
├── Core/          순수 C# (UnityEngine 참조 없음) — 규칙·점수·보드. NUnit 으로 테스트
├── Net/
│   ├── IGameSession.cs      ← 핵심 추상화
│   ├── AiSession.cs         HTTP: /start, /move (UnityWebRequest)
│   ├── RoomSession.cs       (5단계) WebSocket 멀티
│   └── ApiClient.cs         재시도·타임아웃·헤더
├── Telemetry/     이벤트 버퍼 → 서버 전송 (2단계)
└── Presentation/  카드·보드·연출·UI (UGUI 또는 UI Toolkit)
```

**`IGameSession` 이 이 계획의 이음새다.** UI 는 "카드가 왔다 / 내가 놓았다 / 상대가 놓았다 / 끝났다" 이벤트만 안다.
AI 대전이든 사람 8명 방이든 같은 UI 가 돈다. 처음부터 이렇게 나누면 5단계에서 UI 를 다시 짜지 않는다.

```csharp
public interface IGameSession {
    event Action<int /*card*/, int /*turn*/> CardDealt;
    event Action<string /*seat*/, int /*slot*/, int /*card*/> Placed;   // 상대(들)
    event Action<Scoreboard> ScoresChanged;
    event Action<GameResult> Finished;
    Task StartAsync(SessionOptions o);
    Task PlaceAsync(int slot, int thinkMs);
}
```

### 서버 쪽 변경

거의 없다. 지금 API 를 그대로 쓴다. 바뀌는 것:

- `x-streams-client` 헤더를 읽어 `streams_games.client` 에 기록 (2단계 마이그레이션과 함께).
- 토큰을 `PlayerPrefs` 에 두면 앱을 껐다 켜도 이어서 둘 수 있다 (지금 웹은 새로고침하면 판이 날아감 — 같이 고칠 수 있음).

### WebGL 을 사이트에 올릴 때 주의

- **파일 크기**: Workers 정적 파일은 **한 파일 25 MiB 제한**이 있다. `.wasm`/`.data` 가 넘으면 R2 에 올리고 거기서 받는다.
  처음부터 코드 스트리핑(High), 에셋 압축, IL2CPP 최적화로 작게 유지한다.
- **압축**: Unity 의 Brotli 압축 빌드는 서버가 `Content-Encoding: br` 을 붙여 줘야 한다.
  가장 간단한 방법은 Unity 압축을 **끄고**(Disabled) Cloudflare 가 전송 압축을 하게 두는 것.
- **페이지**: `src/pages/games/streams.astro` 를 Unity 로더를 띄우는 페이지로 바꾸거나, 전환 기간에는
  `/games/streams/` (HTML) 과 `/games/streams-unity/` 를 나란히 두고 데이터로 비교한 뒤 교체한다.
- 모바일 브라우저 WebGL 은 무겁다. 모바일은 네이티브 빌드가 기본, 모바일 웹은 지금 HTML 버전을 남겨 두는 것도 선택지.

### 완료 기준

- Unity WebGL 로 5단계 난이도 모두 끝까지 플레이, 점수가 서버와 일치.
- D1 에 `client = 'unity-webgl'` 로 기록이 쌓임.

## 2단계 — 데이터 수집 강화 (2주, 1단계와 겹쳐 진행 가능)

지금 기록은 "게임 한 판 + 턴마다 카드·칸·생각 시간"이다. AI 학습(사람 모방)에는 이게 핵심이라 그대로 두고, 늘린다.

### 마이그레이션 `0003_streams_clients.sql`

```sql
ALTER TABLE streams_games ADD COLUMN client TEXT;          -- web/1, unity-webgl/0.1.0, unity-android/…
ALTER TABLE streams_games ADD COLUMN mode TEXT NOT NULL DEFAULT 'ai';   -- ai | pvp (5단계)
-- ai_model 은 이미 있음 → 4단계부터 실제 버전이 들어간다
```

### 새 테이블 `streams_events` (선택적 행동 기록)

턴 기록으로 못 담는 것: 칸 위에서 망설임(호버·드래그 후 취소), 판 포기, 재대전, 세션 길이.

```sql
CREATE TABLE streams_events (
  game_id TEXT, player_id TEXT, seq INTEGER, type TEXT, data TEXT /*JSON*/, client_ts INTEGER, created_at TEXT
);
```

- Unity 는 이벤트를 버퍼에 모아 턴마다(또는 5초마다) `POST /api/streams/events` 로 한 번에 보낸다.
- **학습용 원본(turns)과 분석용 이벤트(events)를 섞지 않는다.** 이벤트는 잃어도 되는 것, 턴은 잃으면 안 되는 것.
- 개인정보: 지금처럼 익명 `player_id` 만. 계정·이메일은 넣지 않는다. 사이트에 수집 항목 안내 문구 추가.

### 데이터 품질 규칙 (학습에 넣을 판 고르기)

- `attempts > 1` 턴이 있는 판 제외 (지금 규칙 유지).
- `think_ms` 이상치(예: 10분 넘게 자리 비움) 표시.
- 클라이언트별 분포 비교 — Unity 에서 두는 방식이 웹과 다르면(예: 터치라 오른쪽 칸을 덜 씀) 모델 학습 때 구분 변수로 쓴다.

규칙은 D1 뷰 두 개에 있다 (migration 0005). **내보내기·분석은 원본 테이블 대신 이 뷰를 읽는다.**

| 뷰 | 담는 것 |
|---|---|
| `streams_clean_games` | 끝난 AI 대전 중 20턴이 다 있고, 에디터·로컬 테스트(`unity-editor/…`)가 아니고, `attempts > 1` 턴이 없는 판. `client_kind`(web · unity-webgl …), `max_think_ms`, `has_slow_turn` |
| `streams_clean_turns` | 위 판들의 턴. `slow_turn` = 생각 시간 기록이 없거나 10분(600000ms) 초과 — **빼지 않고 표시만** 한다 |

```sh
npx wrangler d1 execute streams-records --remote --json --command "SELECT * FROM streams_clean_turns" > turns.json
```

## 3단계 — 실시간 웹 반영 (2주)

"수집된 데이터가 실시간으로 웹에 올라간다"를 **Durable Object `StatsHub` 하나**로 한다.

### 흐름

```text
/move (판이 끝남) ──ctx.waitUntil──▶ StatsHub.record(result)
                                         │  메모리 집계 갱신 + DO storage 에 저장
                                         └─▶ 연결된 웹소켓 전부에 방송 (최대 초당 1~2회로 묶음)
웹 /games/streams/live  ──WebSocket──▶ StatsHub  (접속 즉시 현재 스냅샷을 받음)
```

### 보여 줄 것

- 지금 진행 중인 판 수, 오늘 끝난 판 수
- 난이도별 사람 승률 · 평균 점수 (AI 평균 22/33/39/47/49 과 나란히)
- 최근 끝난 판 흐름 (익명, 점수와 난이도만)
- 오늘 최고 점수, 전체 최고 점수, 점수 분포 히스토그램
- 칸별 첫 카드 배치 히트맵 (사람들이 1~30 을 어디에 먼저 두는지 — STREAMS 다운 볼거리)

### 설계 포인트

- **D1 을 실시간으로 조회하지 않는다.** 집계는 DO 안에 있고, D1 은 원본 보관용. 웹 트래픽이 D1 을 치지 않는다.
- DO 가 초기화되거나 집계 방식을 바꾸면 D1 에서 한 번 다시 계산해 채운다 (`/api/streams/stats/rebuild`, 관리자용).
- **웹소켓 하이버네이션 API** 를 쓰면 보는 사람이 가만히 있을 때 DO 가 비용 없이 잠든다.
- 웹소켓이 안 되는 환경을 위해 `GET /api/streams/stats` (스냅샷, 5초 캐시)도 둔다. Unity 결과 화면도 이걸로 "상위 몇 %" 를 보여 줄 수 있다.
- 이 DO 패턴이 5단계 `Room` 의 연습이 된다.

## 4단계 — AI 업데이트 파이프라인 (계속)

"에이전트는 지금 것으로 시작하고 계속 업데이트" 를 안전하게 하려면 **모델에 버전을 붙인다.**

- KV 키를 `streams/models/{version}/human_bc.bin` 식으로 바꾸고, `streams/active.json` 이 난이도별로 쓸 버전을 가리킨다.
  지금 코드의 상수 `AI_MODEL = "v17-pikl"` 를 이 값으로 대체 → `streams_games.ai_model` 에 실제 버전이 남는다.
- **학습 루프**: D1 내보내기(`wrangler d1 export` 또는 전용 export 엔드포인트) → streams-v17 에서 human_bc 재학습 →
  `runtime/ts` 산출물(가중치 + testvec) → `ai.test.ts` 로 TS 추론 일치 확인 → KV 업로드 → `active.json` 전환.
- **A/B**: `active.json` 에 비율을 두면(예: 레벨 3 은 새 모델 20%) 실제 사람 상대 승률로 비교할 수 있다. 3단계 대시보드에 모델별 칸 추가.
- 난이도 표시 점수(22/33/…)는 하드코딩(`script.js`, `ai.ts` 주석)되어 있으니 `active.json` 에서 내려주게 바꾼다 — Unity 도 같은 값을 받는다.
- 네트워크 구조가 바뀌면(층 수 등) `PolicyNet` 도 버전별로 나눠야 하니, manifest 에 구조 정보를 같이 넣는다.
- (선택, 나중) 오프라인 모드가 필요하면 Unity Inference Engine(구 Sentis)으로 ONNX 를 기기에서 돌릴 수 있다.
  단 가중치가 클라이언트에 풀리므로 **싱글 연습용 쉬운 난이도만** 고려한다. 기본은 서버 추론 유지.

## 5단계 — 멀티플레이 (4~6주)

### 게임 방식

STREAMS 는 원래 여러 명이 **같은 카드를 동시에 받는** 게임이라 멀티에 잘 맞는다.

- 방 하나 = DO `Room` 인스턴스 하나. 2~8명(설정 가능), 빈자리는 AI(난이도 선택)로 채울 수 있다.
- 턴 흐름: 카드 공개 → 모두 놓음(또는 제한 시간 끝) → 다음 카드. 시간 초과면 서버가 자동으로 둠 (AI 레벨1 정책 또는 무작위 빈칸).
- 다른 사람 보드는 **놓은 뒤에** 공개 (동시에 두는 공정성). 덱은 방 안에만 있다.

### 서버 (Worker + DO)

```text
POST /api/streams/rooms          방 만들기 (비공개 코드) 또는
POST /api/streams/match          빠른 매치 → Lobby DO 가 방 배정
GET  /api/streams/rooms/{id}/ws  웹소켓 입장 (seatToken 으로 재접속)
```

메시지 (JSON, 클라이언트 → 서버 / 서버 → 클라이언트):

```text
→ place {turn, slot, thinkMs}          ← card {turn, card, deadline}
→ ready / leave                        ← placed {seat, turn}         (누가 놨는지만)
                                       ← reveal {turn, slots{seat:slot}, scores}
                                       ← state {…}                   (재접속 시 전체 상태)
                                       ← finished {ranking}
```

- **상태는 DO 안에만** 있다. 싱글의 암호화 토큰 방식(되돌려 두기 문제 → attempts 컬럼)이 멀티에선 필요 없다.
- DO storage 에 턴마다 저장 → DO 가 재시작돼도 판이 이어진다. `alarm()` 으로 턴 제한 시간 처리.
- 판이 끝나면 D1 에 기록(`mode = 'pvp'`, 좌석별 보드) + `StatsHub` 에 결과 전달 → 3단계 대시보드에 멀티 판도 실시간 반영.
- 멀티 기록은 사람 vs 사람이 **같은 카드 순서**를 받은 데이터라 AI 학습에 특히 좋은 비교 데이터가 된다.

### Unity

- `RoomSession : IGameSession` 추가. WebGL 에서도 되는 웹소켓 라이브러리 필요 (예: NativeWebSocket) — `System.Net.WebSockets` 는 WebGL 에서 안 됨.
- 로비 UI, 방 코드 입력, 상대 보드 여러 개 표시, 연결 끊김/재접속 처리.

### 신원과 랭킹 (멀티 후반)

- 처음엔 익명 `player_id` + 닉네임. 부정행위 방지와 랭킹이 필요해지면 로그인(예: 이메일 링크, OAuth) 추가.
- 랭킹은 Glicko-2 같은 레이팅. 레이팅 계산도 판이 끝날 때 DO → D1.
- 남용 방지: 방 생성·매치 요청에 속도 제한(Workers Rate Limiting), 메시지 크기·빈도 제한.

---

## 일정 요약

| 단계 | 내용 | 기간(대략) | 의존 |
|---|---|---|---|
| 0 | API 계약·버전 헤더·규칙 테스트 벡터 | 1주 | — |
| 1 | Unity 싱글 (WebGL → PC → 모바일) | 3~4주 | 0 |
| 2 | 데이터 수집 강화 (마이그레이션, 이벤트) | 2주 | 0 (1과 병행) |
| 3 | 실시간 통계 (StatsHub DO + 웹 페이지) | 2주 | 2 |
| 4 | 모델 버전 관리·학습 루프·A/B | 계속 | 2 |
| 5 | 멀티플레이 (Room/Lobby DO, Unity 웹소켓) | 4~6주 | 1, 3 |

## 위험과 대응

| 위험 | 대응 |
|---|---|
| WebGL 빌드가 25 MiB 파일 제한을 넘음 | 스트리핑·압축, 넘으면 R2 |
| C# 규칙과 서버 규칙이 어긋남 | 점수는 항상 서버 값을 표시, 클라이언트 계산은 미리보기용. 테스트 벡터로 CI 확인 |
| 모델 교체 후 난이도 체감이 바뀜 | 버전 기록 + A/B + 대시보드에서 레벨별 승률 감시, `active.json` 한 줄로 되돌림 |
| 멀티 동시 접속 급증 | 방마다 DO 가 따로라 수평 확장됨. Lobby 만 병목 → 지역별로 나눔 |
| D1 쓰기 폭증 | 이미 `waitUntil` 비동기 기록. 더 늘면 Queues 로 모아서 배치 쓰기 |

## 정한 것

- 2026-09-29 — **WebGL 먼저**, Unity 프로젝트는 **별도 리포** (`streams-unity`). 0단계 시작.

## 진행

- 0단계: API 계약 `docs/streams-api.md`, `x-streams-client` 헤더 + `streams_games.client` (migration 0003),
  localhost CORS (`worker/streams/client.ts`), 규칙 정답지 `worker/streams/testdata/rules.json` (`worker/streams/vectors.ts`).
- 1단계 시작: 리포 [Matail/streams-unity](https://github.com/Matail/streams-unity) — C# 규칙(정답지 609개 일치),
  `IGameSession`/`AiSession`, 코드로 만든 UGUI 화면, WebGL 빌드 메뉴. 남은 것: 에디터 실행 확인, 사이트에 WebGL 올리기.
- 1단계 (2026-09-30): The STREAMS+ 를 `/games/streams-unity/` 에 올리고 덱 카드를 교체 (도트 아트 화면, 튜토리얼, 소리).
- 2단계 시작 (2026-09-30): migration 0004 (`streams_games.mode`, `streams_events`), `POST /api/streams/events` (`worker/streams/events.ts`),
  Unity 가 `session_start` · `hover`(망설임) · `abandon` · `rematch` 를 5초마다 모아 보냄, 시작 화면에 수집 안내.
- 2단계 데이터 품질 (2026-09-30): 규칙을 뷰 `streams_clean_games` · `streams_clean_turns` 로 (migration 0005).

## 정해야 할 것

- 모바일 앱 출시 여부
- 멀티 최대 인원, 빈자리 AI 허용 여부, 턴 제한 시간
- 실시간 대시보드를 공개 페이지로 둘지, 관리자 전용으로 둘지
- 로그인을 도입할 시점
