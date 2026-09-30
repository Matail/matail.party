# STREAMS API 계약 (v1)

웹 클라이언트(`public/games/streams/script.js`)와 Unity 클라이언트(`streams-unity` 리포)가 같이 쓰는 서버 API.
구현은 `worker/streams/`. 이 문서와 구현이 다르면 버그다 — 둘을 같이 고친다.

## 공통

- 주소: `https://<사이트 도메인>/api/streams/…` (Unity WebGL 은 같은 도메인에 올리므로 상대 경로 `/api/streams/…`)
- 메서드: 모두 `POST`, 본문은 JSON (`content-type: application/json`)
- 응답: 모두 JSON. 실패하면 HTTP 상태 코드와 `{ "error": "<짧은 영문 사유>" }`

### 요청 헤더 `x-streams-client`

어떤 클라이언트로 둔 판인지 기록한다 (`streams_games.client`). **모든 클라이언트가 보내야 한다.**

```text
x-streams-client: <종류>/<버전>
```

| 종류 | 쓰는 곳 |
|---|---|
| `web` | 지금의 HTML 버전. 버전은 정수 (`web/1`) |
| `unity-webgl` | Unity WebGL 빌드 (`unity-webgl/0.1.0`) — 버전은 `Application.version` |
| `unity-editor` | Unity 에디터 플레이 모드. 분석에서 뺀다 |
| `unity-windows` · `unity-mac` · `unity-android` · `unity-ios` | 나중 빌드용으로 예약 |

- 형식: `^[a-z][a-z0-9-]{0,31}/[0-9A-Za-z.+-]{1,32}$`
- 없거나 형식이 틀리면 요청은 그대로 처리하고 기록만 `NULL` 로 남긴다 (옛 페이지 캐시 호환).

### CORS

같은 도메인에서 부르면 필요 없다. 테스트용으로 `http://localhost:<port>` · `http://127.0.0.1:<port>` 출처만 허용한다
(Unity "Build And Run" 이 띄우는 로컬 서버). 그 밖의 출처는 브라우저가 막는다.
에디터 플레이 모드와 네이티브 빌드는 브라우저가 아니라 CORS 와 상관없다.

## `POST /api/streams/start` — 새 판

요청

```json
{ "level": 3, "playerId": "0b6e…(선택, 최대 64자)" }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `level` | 정수 1~5 | 1 입문 · 2 보통 · 3 숙련 · 4 고수 · 5 마스터 |
| `playerId` | 문자열, 선택 | 기기에 저장한 익명 id. 웹은 `localStorage['streams-player']`, Unity 는 `PlayerPrefs` 에 UUID |

응답 200

```json
{ "gameId": "a1b2…", "token": "<불투명 문자열>", "level": 3, "levelName": "숙련", "turn": 0, "card": 17 }
```

| 필드 | 설명 |
|---|---|
| `gameId` | 판 id (24자 hex). 표시·로그용 |
| `token` | 게임 상태를 서버가 암호화한 값. **클라이언트는 열어 보거나 고치지 않고 다음 요청에 그대로 돌려준다** |
| `turn` | 지금까지 놓은 카드 수 (0) |
| `card` | 이번에 놓을 카드 (1~30) |

오류: `400 level must be 1~5`

## `POST /api/streams/move` — 이번 카드 놓기

요청

```json
{ "token": "<직전 응답의 token>", "slot": 4, "thinkMs": 2310 }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `token` | 문자열 | 가장 최근 응답의 `token` |
| `slot` | 정수 0~19 | 내 보드의 빈칸 (왼쪽이 0) |
| `thinkMs` | 정수, 선택 | 카드를 **화면에 보여 준 순간부터** 놓기까지 걸린 시간(ms). AI 학습 데이터라 꼭 보낸다 |

응답 200 (진행 중)

```json
{ "token": "<새 token>", "aiSlot": 11, "turn": 5, "playerScore": 12, "aiScore": 9, "nextCard": 22 }
```

응답 200 (마지막 20번째 수)

```json
{ "token": "<새 token>", "aiSlot": 0, "turn": 20, "playerScore": 41, "aiScore": 47, "finished": true }
```

| 필드 | 설명 |
|---|---|
| `aiSlot` | AI 가 **같은 카드**를 놓은 칸 |
| `turn` | 놓은 카드 수 (1~20) |
| `playerScore` · `aiScore` | 지금 보드의 점수. **화면에는 항상 이 값을 쓴다** (클라이언트 계산은 미리보기용) |
| `nextCard` / `finished` | 둘 중 하나만 온다 |

응답 헤더 `server-timing: model;dur=<ms>` — AI 모델을 불러오는 데 걸린 시간 (측정용).

오류

| 상태 | `error` | 뜻 · 클라이언트 처리 |
|---|---|---|
| 400 | `invalid slot` | 범위 밖이거나 이미 찬 칸. 클라이언트 보드가 틀어진 것 — 놓은 카드를 되돌린다 |
| 404 | `game not found` | 토큰이 위조·손상됨 (또는 서버 키 교체). 새 판을 시작한다 |
| 409 | `game finished` | 이미 끝난 판 |
| 500 | `server error` | 잠시 뒤 **같은 토큰으로** 다시 보낸다 |

### 토큰 규칙

- 토큰은 판의 전체 상태(덱 포함)를 담는다. 서버는 판을 따로 들고 있지 않다 → 토큰을 잃으면 판도 잃는다.
- 앱을 껐다 켜도 이어 두려면 토큰과 화면 상태(`card`, `turn`, 두 보드)를 같이 저장한다.
- 옛 토큰을 다시 보내면 그 시점부터 다시 둘 수 있지만, 서버는 처음 둔 수만 학습용으로 인정하고 다시 둔 턴은 `attempts` 를 올린다.
  → 네트워크 오류로 **재시도**할 때는 같은 토큰·같은 `slot` 으로 보낸다. 다른 칸으로 바꿔 보내지 않는다.

## `POST /api/streams/events` — 행동 기록 (묶음)

턴 기록으로 못 담는 행동을 모아 보낸다 (칸 위에서 망설임, 판 포기, 재대전, 세션). 테이블 `streams_events` (migration 0004).
**분석용이라 잃어도 되는 기록이다** — 실패해도 다시 보내지 않고, 게임 진행을 막지 않는다. 학습용 `streams_turns` 와 섞지 않는다.

요청

```json
{
  "sessionId": "0b6e…",
  "playerId": "0b6e…",
  "events": [
    { "seq": 0, "type": "session_start", "ts": 1790000000000 },
    { "gameId": "a1b2…", "seq": 1, "type": "hover", "ts": 1790000001000, "data": "{\"turn\":2,\"slot\":7,\"card\":15,\"ms\":640}" }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `sessionId` | 문자열, 선택 | 앱을 켤 때마다 새로 만드는 id. `[0-9A-Za-z-]{1,64}` |
| `playerId` | 문자열, 선택 | `/start` 와 같은 익명 id |
| `events` | 배열, 최대 50개 | 아래 |
| `events[].seq` | 정수 ≥ 0 | 세션 안의 순번 |
| `events[].type` | 문자열 | `^[a-z][a-z_]{0,31}$` |
| `events[].gameId` | 문자열, 선택 | 판과 상관없으면 생략 |
| `events[].ts` | 정수, 선택 | 클라이언트 시각 (epoch ms) |
| `events[].data` | JSON 문자열 또는 객체, 선택 | 1KB 이하. Unity(JsonUtility)는 문자열로 보낸다 |

형식이 틀린 이벤트는 **그것만 버리고** 나머지를 받는다.

응답 `202 { "accepted": 2 }` (받은 개수) · 오류 `400 invalid body` / `events must be an array` / `at most 50 events`

### 이벤트 종류

| `type` | 언제 | `data` |
|---|---|---|
| `session_start` | 앱(페이지)을 켤 때 한 번 | — |
| `hover` | 빈칸 위에 커서가 머물다가 **놓지 않고** 떠날 때 (망설임, 0.1초 미만은 뺌) | `turn`, `slot`, `card`, `ms` (머문 시간) |
| `abandon` | 끝나지 않은 AI 대전을 두고 새 판(또는 튜토리얼)을 시작할 때. 페이지를 닫고 떠난 판은 `streams_games.status = 'playing'` 으로 남는다 | `turn` (놓은 카드 수), `level` |
| `rematch` | 결과 화면에서 "한 판 더" | `level` |

## 규칙 (클라이언트 이식용)

- 보드 20칸, 덱은 40장 풀(1~10 한 장씩, 11~20 두 장씩, 21~30 한 장씩)에서 무작위 20장.
- 점수: 빈칸을 건너뛰고 왼쪽부터 읽어 **작거나 같은** 숫자로 이어지는 구간마다 `scoreTable[구간 길이]` 를 더한다.
  `scoreTable = [0, 0, 1, 3, 5, 7, 9, 11, 15, 20, 25, 30, 35, 40, 50, 60, 70, 85, 100, 150, 300]`
- 정답지: `worker/streams/testdata/rules.json` (보드 → 구간 길이 → 점수, 600여 개).
  `node worker/streams/vectors.ts` 로 `game.ts` 에서 만들고, `--check` 로 맞는지 확인한다.
  Unity 리포는 이 파일을 복사해 C# 규칙 구현을 테스트한다. 규칙을 바꾸면 다시 뽑아 양쪽에 반영한다.

## 바뀐 기록

| 날짜 | 변경 |
|---|---|
| 2026-09-29 | v1 문서화. `x-streams-client` 헤더, localhost CORS, `streams_games.client` (migration 0003) |
| 2026-09-30 | `POST /api/streams/events`, `streams_events` 테이블과 `streams_games.mode` (migration 0004) |
