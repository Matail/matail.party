/* 좌우로만 움직이는 영역(선반 · 글 읽는 칸)의 공통 동작.
   하는 일은 셋이다.
   1. 세로 휠을 가로로 돌린다 (마우스에는 가로 휠이 없다)
   2. 화면 어디에서 굴려도 그 영역이 움직인다 — 이 사이트는 한 화면이라
      "스크롤할 곳"이 화면에 하나뿐이다. 커서를 선반 위에 정확히 올려야만 움직이면 답답하다
   3. 양 끝에 닿았는지 알려준다 (가장자리 그라데이션) */

/** 이 요소 안쪽에 세로로 스크롤되는 것이 따로 있으면 그쪽에 양보한다 (코드블록 등) */
function scrollableAncestor(node, root) {
	let el = node instanceof Element ? node : null;
	while (el && el !== root && el !== document.body) {
		const s = getComputedStyle(el);
		const canY = /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
		const canX = /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
		if (canY || canX) return el;
		el = el.parentElement;
	}
	return null;
}

export function initHScroll(root = document) {
	root.querySelectorAll('[data-hscroll]').forEach((el) => {
		if (el.dataset.hscrollBound === '1') return;
		el.dataset.hscrollBound = '1';

		const wrap = el.closest('[data-hscroll-wrap]') ?? el.parentElement;

		const mark = () => {
			if (!wrap) return;
			const max = el.scrollWidth - el.clientWidth;
			wrap.dataset.atStart = String(el.scrollLeft <= 1);
			wrap.dataset.atEnd = String(max <= 1 || el.scrollLeft >= max - 1);
		};

		mark();
		el.addEventListener('scroll', mark, { passive: true });
		window.addEventListener('resize', mark);
		/* 글꼴이 늦게 오면 칸 수가 바뀐다 */
		if (document.fonts) document.fonts.ready.then(mark);

		/* 탭으로 링크를 옮겨 다닐 때 그 링크가 화면 안으로 들어오게 한다 */
		el.addEventListener('focusin', (e) => {
			const target = e.target;
			if (target && target !== el && target.scrollIntoView) {
				target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		});
	});

	bindWheel();
}

/* 휠은 창에 한 번만 건다. 페이지가 바뀌어도 그대로 두고, 그때그때
   화면에 있는 가로 스크롤 영역을 찾아 넘긴다. */
let wheelBound = false;

function bindWheel() {
	if (wheelBound) return;
	wheelBound = true;

	window.addEventListener(
		'wheel',
		(e) => {
			/* 가로 휠(트랙패드)은 브라우저에 맡긴다 */
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

			/* 화면에 보이는 가로 스크롤 영역 중 가장 큰 것 하나 */
			const targets = [...document.querySelectorAll('[data-hscroll]')].filter(
				(el) => el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0
			);
			if (!targets.length) return;
			const el = targets.sort(
				(a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
			)[0];

			/* 커서 밑에 따로 스크롤되는 것이 있으면 그쪽이 먼저다 */
			const inner = scrollableAncestor(e.target, el);
			if (inner && inner !== el) return;

			const max = el.scrollWidth - el.clientWidth;
			const next = el.scrollLeft + e.deltaY;

			/* 끝에 닿았고 페이지가 세로로 스크롤되는 상황이면 페이지에 넘긴다 */
			const atEdge = (next < 0 && el.scrollLeft <= 0) || (next > max && el.scrollLeft >= max);
			const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 2;
			if (atEdge && pageScrolls) return;

			e.preventDefault();
			el.scrollLeft = next;
		},
		{ passive: false }
	);
}
