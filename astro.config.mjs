// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 검색 노출: 대표 주소(canonical)·og 이미지 주소와 sitemap 이 이 주소로 만들어진다. 도메인을 바꾸면 여기와
// public/robots.txt, public/games/streams-unity/index.html (Unity 템플릿 원본은 streams-unity 리포),
// public/games/aimbooster/index.html (Unity 템플릿 원본은 aimbooster-unity 리포),
// wrangler.jsonc 의 routes, worker/index.ts 의 SITE 를 같이 바꾼다.
const SITE = 'https://matail.party';

// https://astro.build/config
export default defineConfig({
	site: SITE,
	integrations: [
		sitemap({
			// 옛 HTML 판 STREAMS(지금은 Unity 판 /games/streams-unity/)와 CMS 관리 화면은 검색에 올리지 않는다
			filter: (page) => !page.startsWith(`${SITE}/games/streams/`) && !page.startsWith(`${SITE}/admin`),
			// Unity 게임 페이지는 Astro 페이지가 아니라 public/ 의 정적 파일이라 직접 넣는다
			customPages: [`${SITE}/games/streams-unity/`, `${SITE}/games/aimbooster/`],
		}),
	],
	// 통계는 통계 탭(/stats/)으로 옮겼다
	redirects: { '/games/streams/live': '/stats/streams' },
});
