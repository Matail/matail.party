# AIMBOOSTER API 계약 (v1)

Unity 로 다시 만든 AIMBOOSTER(1인칭 3D, `aimbooster-unity` 리포)가 쓰는 서버 API. 구현은 `worker/aimbooster/`.
이 문서와 구현이 다르면 버그다 — 둘을 같이 고친다.

판정(맞힘 · 놓침 · 언제 끝나는지)은 **Unity 가 한다**. 서버는 판을 실시간으로 따라가지 않고, 끝난 판의 요약이
규칙상 가능한지만 검사한다(`validate.ts`). 의심 판도 기록은 남기되 집계와 순위에서 뺀다.

## 공통

- 주소: `https://<사이트 도메인>/api/aimbooster/…` — WebGL 빌드는 게임을 연 페이지의 도메인에 그대로 붙인다 (`Application.absoluteURL`).
  에디터 · 데스크톱은 `AimApi.baseUrl` 을 넣어야 켜지고, 비워 두면 오프라인(요청 없음)이다.
- 본문은 JSON (`content-type: application/json`). 응답도 JSON, 실패하면 HTTP 상태 코드와 `{ "error": "<짧은 영문 사유>" }`.
- 서버가 안 되거나 느려도 게임은 막지 않는다 — 결과 화면에 순위 줄만 빠지고 기기 기록(PlayerPrefs)은 그대로 쌓인다.

### 요청 헤더 `x-aimbooster-client`

STREAMS 의 `x-streams-client` 와 같은 형식이다 (`<종류>/<버전>`, 버전은 `Application.version`).

| 종류 | 쓰는 곳 |
|---|---|
| `unity-webgl` | 사이트에 올린 WebGL 빌드 |
| `unity-editor` | 에디터 플레이 모드 · 테스트. **기록은 남지만 집계 · 순위에 더하지 않는다** |
| `unity-<플랫폼>` | 나중 빌드용 |

없거나 형식이 틀리면 요청은 그대로 처리하고 `client` 만 `NULL` 로 남긴다 (집계에는 들어간다).

### CORS

같은 도메인이면 필요 없다. 테스트용으로 `http://localhost:<port>` · `http://127.0.0.1:<port>` 출처만 허용한다 (STREAMS 와 같은 규칙).

## `POST /api/aimbooster/start` — 새 판

판을 시작하는 버튼을 누를 때 보낸다. 카운트다운(3초) 동안 응답이 오므로 기다리지 않는다.

요청

```json
{ "playerId": "9f1c…(선택, 최대 64자)", "seed": 123456789 }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `playerId` | 문자열, 선택 | 기기의 익명 id. Unity 는 `PlayerPrefs["playerId"]` 에 GUID |
| `seed` | 정수 0 ~ 2³²−1, 선택 | 클라이언트가 고른 시드 (과녁 위치용). 없으면 서버가 고른다 |

응답 200

```json
{ "runId": "3fa1…", "token": "<불투명 문자열>", "seed": 123456789, "rulesVersion": 4 }
```

- `token` — 판 id · 시드 · **시작 시각**을 서버 키로 봉인(AES-GCM)한 값. 클라이언트는 열거나 고치지 않고 `/finish` 에 그대로 돌려준다.
- `rulesVersion` — 서버가 아는 규칙 버전. 게임의 `Rules.Version` 과 다르면 그 판은 의심 판이 된다.

## `POST /api/aimbooster/finish` — 끝난 판 보내기

요청

```json
{
  "token": "<start 의 token>",
  "summary": {
    "rulesVersion": 4, "seed": 123456789, "durationMs": 41300, "shots": 52, "hits": 44, "misses": 3,
    "spawned": 47, "maxLevel": 3, "reactionsMs": [412, 388, …], "wallHits": [12, 20, 12], "wallMisses": [1, 1, 1]
  }
}
```

`summary` 는 Unity `RunSummary` 를 `JsonUtility` 로 그대로 직렬화한 것이다.

| 필드 | 설명 |
|---|---|
| `durationMs` | 버틴 시간 (판 시계, 카운트다운 · 일시정지 제외) |
| `shots` · `hits` · `misses` | 쏜 발 · 맞힌 과녁 · 놓친 과녁 (끝난 판은 항상 3) |
| `spawned` · `maxLevel` | 나온 과녁 수 · 도달 LEVEL |
| `reactionsMs` | 맞힌 과녁마다 나온 순간부터 맞힐 때까지 (hits 개) |
| `wallHits` · `wallMisses` | 벽별 (0 왼쪽 · 1 정면 · 2 오른쪽) |

응답 200

```json
{ "runId": "3fa1…", "counted": true, "suspect": false, "reasons": [], "survivalTop": 22, "accuracyTop": 10, "runs": 32 }
```

| 필드 | 설명 |
|---|---|
| `counted` | 공개 집계에 더해졌는지 (의심 판 · 에디터 판 · 수집 꺼짐이면 `false`) |
| `suspect` · `reasons` | 검사에 걸린 이유들 (아래 표) |
| `survivalTop` · `accuracyTop` | "상위 n%" (1 ~ 100). 의심 판이거나 **나를 더해 30판이 안 되면 `null`** |
| `runs` | 비교한 판 수 (나를 더하기 전) |

상위 % 는 나보다 나은 판 수로 센다: `ceil((나보다 나은 판 + 1) / (전체 + 1) × 100)`. 1등이어도 0% 가 아니고, 꼴찌는 100%.
생존은 0.5초 칸, 명중률은 1% 칸 분포로 계산한다 (같은 칸은 "나보다 낫지 않음").

오류

| 상태 | `error` | 뜻 |
|---|---|---|
| 400 | `invalid <필드>` | 요약 모양이 틀림 |
| 404 | `run not found` | 토큰 위조 · 손상 (또는 서버 키 교체) |
| 409 | `run finished` | 같은 토큰으로 이미 끝냄 — 재시도하지 않는다 |

### 의심 판 검사 (`validate.ts`)

| `reasons` | 조건 |
|---|---|
| `rules version` | 규칙 버전이 다름 |
| `longer than real time` | `durationMs` > 토큰 발급부터 흐른 실제 시간 + 2초 |
| `shorter than possible` | 한 발도 안 쏘고 버틴 최단 시간(5.5초)보다 짧음 |
| `must end with 3 misses` | `misses` ≠ 3 |
| `spawn count` · `level` | 버틴 시간으로 정해지는 과녁 수 · LEVEL 과 다름 (나오는 시각은 시드와 상관없이 규칙으로만 정해진다) |
| `more targets than spawned` · `more hits than shots` | 합이 안 맞음 |
| `reaction count` · `reaction longer than lifetime` | 반응 시간 개수 ≠ hits, 또는 과녁 수명보다 김 |
| `inhuman reactions` | 맞힌 과녁 5개 이상인데 반응 시간 중앙값 < 120ms |
| `wall totals` | 벽별 합 ≠ hits · misses |
| `seed` | 토큰의 시드와 다름 |

## `GET /api/aimbooster/rank?durationMs=&hits=&shots=` — 순위만 묻기

기록하지 않고 지금 분포에서 상위 % 만 돌려준다. 게임 안 통계 창이 "내 최고 기록 · 전체 명중률" 로 부른다.

```json
{ "survivalTop": 18, "accuracyTop": 31, "runs": 32 }
```

이 기록을 더해 30판이 안 되면 둘 다 `null`. 세 값이 0 이상 정수가 아니면 `400`.

## `GET /api/aimbooster/stats` · `GET /api/aimbooster/live` — 공개 집계

`/stats` 는 지금 집계 한 번(캐시 5초), `/live` 는 웹소켓으로 바뀔 때마다(최대 초당 1번) 같은 모양을 보낸다. `/stats/aimbooster/` 페이지가 쓴다.

```json
{
  "day": "2026-10-02", "updatedAt": 1790874625973, "playing": 1,
  "started": 40, "finished": 32, "best": 7480, "todayFinished": 32, "todayBest": 7480,
  "accuracyAll": 0.58,
  "survivalBinMs": 500, "survival": [0, 0, …], "accuracy": [0, …], "reactionBinMs": 25, "reaction": [0, …]
}
```

- `playing` — 시작하고 30분 안에 끝나지 않은 판. `started` 는 에디터를 뺀 시작 수, 나머지는 깨끗한 판(`aim_clean_runs`)만.
- 분포 배열은 끝의 0 을 잘라 보낸다. `survival[i]` 는 `i × 500ms` 칸, `reaction[i]` 는 `i × 25ms` 칸 (판별 반응 시간 중앙값).
- 판 하나하나를 가리키는 값(id · 시각 · 클라이언트 · `player_id`)은 나가지 않는다.

## 게임 → 통계 페이지: `localStorage["aimbooster-me"]`

서버 API 는 아니지만 게임과 사이트가 나누는 약속이라 여기 적는다. WebGL 게임(`/games/aimbooster/`)은 판이 끝날 때마다
이 브라우저 기록의 요약을 같은 사이트 `localStorage` 에 둔다 (aimbooster-unity `SiteBridge`). 통계 페이지(`/stats/aimbooster/`)가
읽어 분포 위에 "내 위치" 를 그리고 `/rank` 로 상위 % 를 묻는다 — 게임 안 통계 창과 같은 값.

```json
{ "bestMs": 41300, "hits": 512, "shots": 640, "runs": 14 }
```

`bestMs` 는 가장 오래 버틴 판, `hits` · `shots` 는 모든 판의 합, `runs` 는 판 수 (게임이 기기에 둔 최근 500판 기준).
페이지는 이 숫자 셋만 `/rank` 에 물을 뿐이고 서버는 기록하지 않는다 (id 없음).

## 저장

- D1 `aim_runs` (migration `0007_aimbooster.sql`) — 시작 때 한 줄, 끝나면 같은 줄을 채운다. 의심 판은 `suspect = 1` · `suspect_reasons`.
  뷰 `aim_clean_runs` = 끝났고, 의심 아니고, 에디터 아닌 판.
- 실시간 집계는 Durable Object `AimStatsHub` (바인딩 `AIM_STATS`) 가 분포 히스토그램으로 들고 있다. 저장된 집계가 없으면 D1 에서 다시 센다.
- 관리자 설정 `aimbooster/collect` 가 `false` 면 판은 되지만 기록 · 집계를 남기지 않는다 (판 단위, 시작 때 토큰에 들어간다).

## 배포 전에 (한 번)

로컬(`wrangler dev`)은 `.dev.vars` 의 `AIMBOOSTER_KEY` 와 로컬 D1 으로 돈다. 실제 배포 전에:

1. 토큰 키 — 32바이트 랜덤을 base64 로 만들어 비밀값으로 넣는다 (바꾸면 진행 중인 판의 토큰이 모두 404 가 된다).

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   npx wrangler secret put AIMBOOSTER_KEY
   ```

2. D1 마이그레이션

   ```sh
   npx wrangler d1 migrations apply streams-records --remote
   ```

3. 배포 — `wrangler.jsonc` 의 Durable Object 마이그레이션 `v2` (`AimStatsHub`) 가 같이 올라간다.

## 로컬에서 확인

```sh
npx wrangler d1 migrations apply streams-records --local
npx wrangler dev --port 8787
node worker/aimbooster/rules.test.ts && node worker/aimbooster/validate.test.ts && node worker/aimbooster/stats.test.ts
```

Unity 쪽은 `AIMBOOSTER_API=http://127.0.0.1:8787/api/aimbooster` 를 넣고 PlayMode 테스트를 돌리면
`ServerRankShownOnResultAndStats` 가 실제 서버로 한 판을 보내고 결과 화면 · 통계 창의 순위 줄을 확인한다 (판 30개 이상 쌓인 DB 필요).
