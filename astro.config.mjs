// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// 통계는 통계 탭(/stats/)으로 옮겼다
	redirects: { '/games/streams/live': '/stats/streams' },
});
