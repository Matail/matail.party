# 밥 줘! 사이트 배포 순서 (0단계)

`matail.party/games/feedme/` — 주소를 아는 사람만 여는 페이지다. 홈 카드도, 검색 노출도 없다.
Unity 프로젝트는 별도(`C:\feedme-unity`)이고, 여기에는 WebGL 빌드만 올린다. THE STREAMS+(`public/games/streams-unity/`)와 같은 방식이다.

## 붙는 방식

- `public/games/feedme/` 에 빌드(`index.html` + `Build/`)를 그대로 두면 끝이다. `astro build` 가 `dist/` 로 복사하고,
  Worker(`worker/index.ts`)는 `/api/*` 만 가로채고 나머지를 정적 파일로 넘긴다. 라우팅·설정 파일은 고치지 않는다.
  로컬 `wrangler dev` 로 확인: `/games/feedme/` 200, `/games/feedme` 307(→ 슬래시), 없는 파일 404.
- **홈 카드는 `src/content/games/feedme.md` 가 있어야 생긴다.** 덱이 `games` 컬렉션 전부를 읽기 때문이다. 0단계에서는 만들지 않는다.
- sitemap 에는 `public/` 정적 페이지가 자동으로 안 들어간다 (`astro.config.mjs` 의 `customPages` 에 적을 때만). 적지 않는다.
- `robots.txt` 는 `Allow: /` 라서, 검색에서 빼려면 페이지 자체에 `<meta name="robots" content="noindex">` 가 있어야 한다.
  WebGL 템플릿(`Assets/WebGLTemplates/FeedMe`, feedme-unity)이 넣는다.

## 제한과 실측 (STREAMS+ 운영 파일, 2026-10-03)

- 정적 파일 1개당 25 MiB(26,214,400 바이트) 이하. 넘으면 푸시 뒤 빌드의 에셋 업로드가 실패한다.
- 정적 파일의 `Cache-Control` 은 `public, max-age=0, must-revalidate`. 재방문은 ETag 로 304 가 나온다.
- Cloudflare 가 전송 압축을 한다. 단 `.data` 는 `Content-Type` 이 없어 **압축되지 않는다.**

| 파일 | 디스크 | 받은 양 | 압축 |
|---|---|---|---|
| `.wasm` | 18,339,945 | 6,637,613 | br |
| `.framework.js` | 415,850 | 91,030 | br |
| `.loader.js` | 26,982 | 9,548 | br |
| `.data` | 7,835,756 | 7,835,756 | 없음 |

밥 줘! 빌드는 이 표와 나란히 비교한다.

## 미리보기 주소가 열리지 않는다

my-site 는 Durable Object(`StatsHub`, `AimStatsHub`)를 써서 workers.dev 미리보기 주소가 만들어지지 않는다
(Cloudflare 문서의 제한. 버전 목록의 `has_preview` 가 전부 `false`, 아래 주소가 모두 404, 2026-10-03 확인).

- 브랜치 주소 모양: `<브랜치 이름의 / 를 - 로>-my-site.matail.workers.dev` (예: `claude-aimbooster-card-my-site.matail.workers.dev`)
- 버전 주소 모양: `<버전 ID 앞 8자>-my-site.matail.workers.dev` (예: `f02991a0-my-site.matail.workers.dev`)

그래서 푸시 뒤 측정은 아래 중 하나로 한다 (오케스트레이터가 고른다).

| | 방법 | 비고 |
|---|---|---|
| A | main 에 머지한 뒤 `matail.party/games/feedme/` 에서 측정 | 운영과 같은 조건. 홈 카드·sitemap·검색 노출이 없어 주소를 아는 사람만 연다 |
| B | Workers Builds 를 Worker Previews 로 전환 (대시보드 1회, 되돌릴 수 없음) + `wrangler.jsonc` 에 `previews` 블록 | 사이트 공통 파일과 모든 브랜치 빌드에 영향. 사용자 결정 |
| C | 로컬 `npm run build` + `npx wrangler dev` 에서 로딩·콘솔 오류만 확인 | 로컬은 파일 전부 gzip 이라 전송량·시간은 실제와 다르다 |

## 빌드가 나오면

1. **확인** — `C:\feedme-unity\Builds\WebGL\` 에 `index.html` 과 `Build/` 가 있고, 25 MiB 넘는 파일이 없는지 본다.
2. **복사** (기존 파일을 먼저 지운다)
   ```powershell
   $src = 'C:\feedme-unity\Builds\WebGL'
   $dst = 'C:\Web\matail.party\public\games\feedme'
   if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
   Copy-Item $src $dst -Recurse
   Get-ChildItem $dst -Recurse -File | Sort-Object Length -Descending | Select-Object -First 5 FullName, Length
   ```
3. **로컬 확인** — `npm run build`, `npx wrangler dev --port 8799 --local`, `http://127.0.0.1:8799/games/feedme/` 를 열어 콘솔 오류를 본다. 끝나면 서버를 끈다.
4. **커밋·푸시** — 경로를 지정해서만 `git add` 한다. `public/fontcheck/` 는 사용자 파일이라 건드리지 않는다.
   ```sh
   git status --short
   git add public/games/feedme docs/feedme-deploy.md
   git commit -m "feat: 밥 줘! 0단계 WebGL 빌드 (matail.party/games/feedme/)"
   git push -u origin claude/feedme-phase0
   ```
5. **빌드 확인** — Workers Builds MCP `workers_builds_list_builds`(workerId `fce7815df5ed4979ad3d1eb6b844822e`)에서 `claude/feedme-phase0` 가 `success` 인지,
   `workers_builds_get_build_logs` 에서 `Found N new or modified static assets` 에 `/games/feedme/...` 파일이 있는지 본다.
6. **측정** (위 표의 A 또는 B 가 정해진 뒤, Claude Browser)
   - 새 탭에서 주소를 연다. 처음 방문(캐시 없음)과 다시 방문(304)을 따로 잰다.
   - 파일별 전송량 · 소요: `javascript_tool` 로
     `performance.getEntriesByType('resource').map(r => ({ f: r.name.split('/').pop(), 받음: r.transferSize, 본문: r.encodedBodySize, 풀면: r.decodedBodySize, ms: Math.round(r.duration) }))`
   - 첫 화면까지: 페이지 시작부터 `#loading` 이 사라질 때까지의 `performance.now()` (템플릿이 `createUnityInstance` 가 끝나면 지운다). 200 ms 간격으로 확인한다.
   - 콘솔 오류 수: `read_console_messages` 의 오류 수준.
   - 위 표(STREAMS+)와 나란히 보고에 적는다. 배포 뒤 모습은 Cloudflare Browser 스크린샷으로 남긴다.
7. PR 은 열 수 있지만 머지하지 않는다 (0-8, 사용자 승인 뒤 오케스트레이터).

## 0단계 확인 결과 (2026-10-03, feedme-unity `6e1aada`)

| 파일 | 디스크 | STREAMS+ 대비 |
|---|---|---|
| `.wasm` | 21,274,124 | +16% |
| `.data` | 9,364,913 | +20% (압축되지 않으므로 받는 양도 같다) |
| `.framework.js` | 422,894 | +2% |
| `.loader.js` | 26,982 | 같음 |
| `index.html` | 9,275 | |

합계 29.7 MiB, 25 MiB 넘는 파일 없음. 빈 장면인데도 `.wasm`·`.data` 가 STREAMS+ 보다 크다.

- 로컬(`wrangler dev --local`) 200 / 307 / 404 확인, Claude Browser 에서 로딩 막대가 사라지고 Unity 시작, 콘솔 오류 수준 0건.
- 콘솔: 경고 6건(`WebGL: INVALID_ENUM: getInternalformatParameter`), Unity 로그 2건
  (`Hidden/CoreSRP/CoreCopy`, `Hidden/Universal/HDRDebugView` shader is not supported on this GPU) — 빈 장면에서는 화면에 영향이 없다. feedme-unity 가 확인한다.
- Workers Builds 는 2026-10-03 05:54 UTC 부터 Cloudflare 장애("Workers Build failing to start")로 시작하지 못하는 구간이 있었다. 이때 푸시한 빌드는 `Build failed to initialize and was timed out` 이었고 내용과 무관하다.

## 홈 카드에 필요한 것 (0단계에서는 만들지 않는다)

- `src/content/games/feedme.md` — `title`, `description`, `url: '/games/feedme/'`, `engine: 'unity'`, `color`(lime·pink·cyan), `accent`, `lettering`, `releaseDate`, `status`
- `public/art/feedme-anim.png` (키아트 9프레임 가로 시트), `public/art/emblem-feedme.png` (엠블럼 9프레임), `public/og/feedme.png` (1200×630)
- `astro.config.mjs` 의 `customPages` 에 주소 추가 (사이트 공통 파일)
- 템플릿 머리말의 `noindex` 를 빼고 canonical·og 를 넣는다
