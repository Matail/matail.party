import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		tags: z.array(z.string()).optional(),
		// 글이 서는 줄. 블로그 첫 화면이 이 값으로 줄을 나눈다
		category: z.enum(['devlog', 'craft', 'notes']).default('devlog'),
		// 카드와 글 머리에 깔리는 그림 (public 기준 경로). 없으면 글자만 있는 카드가 된다
		cover: z.string().optional(),
		// 맨 위 큰 카드로 올릴 글. 여러 개면 가장 최근 것이 올라간다
		featured: z.boolean().default(false),
	}),
});

const games = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		// 카드에 보여줄 짧은 설명
		shortDescription: z.string().optional(),
		// 게임 URL: 내부면 /games/xxx/, 외부면 https://...
		url: z.string(),
		// 'internal' (같은 사이트) / 'external' (서브도메인 등)
		type: z.enum(['internal', 'external']).default('internal'),
		// 게임 엔진: html, unity, unreal, godot 등
		engine: z.string().optional(),
		// 색상 (카드 썸네일 배경) — 'lime', 'pink', 'cyan' 중 하나
		color: z.enum(['lime', 'pink', 'cyan']).default('lime'),
		// 이모지 또는 짧은 텍스트 (썸네일에 표시)
		thumb: z.string().default('🎮'),
		// 덱 카드에 깔리는 키아트 (public 기준 경로). 없으면 이모지로 대체된다
		art: z.string().optional(),
		// 카드 고유 색 — 레퍼런스처럼 카드마다 화면 전체 색이 바뀐다
		accent: z.string().optional(),
		// 카드 레터링에 쓸 표기 (줄바꿈은 | 로). 없으면 title 을 쓴다
		lettering: z.string().optional(),
		// 카드에 커서를 올리면 나타나는 픽셀아트 엠블럼 (9프레임 가로 스프라이트 시트)
		emblem: z.string().optional(),
		// 키아트가 움직이는 경우: 가로로 이어 붙인 스프라이트 시트와 그 프레임 수
		artFrames: z.number().int().min(2).optional(),
		// 공개 통계 페이지가 /stats/<id>/ 에 있다 (통계 탭에 올라간다)
		stats: z.boolean().default(false),
		// 태그
		tags: z.array(z.string()).optional(),
		// 출시일
		releaseDate: z.coerce.date(),
		// 상태: published(공개), wip(작업중), planned(계획중)
		status: z.enum(['published', 'wip', 'planned']).default('published'),
	}),
});

export const collections = { blog, games };