// STREAMS 클라이언트. 덱은 서버에만 있고, 서버가 카드를 한 장씩 준다.
const LEVELS = [
	{ level: 1, name: '입문', avg: 22 },
	{ level: 2, name: '보통', avg: 33 },
	{ level: 3, name: '숙련', avg: 39 },
	{ level: 4, name: '고수', avg: 47 },
	{ level: 5, name: '마스터', avg: 49 },
];
const API = '/api/streams';
const $ = (id) => document.getElementById(id);

let game = null;      // { gameId, token(암호화된 게임 상태), level, levelName, card, turn }
let myBoard, aiBoard, busy = false, cardShownAt = 0, lastAi = -1;

function playerId() {
	try {
		let id = localStorage.getItem('streams-player');
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem('streams-player', id);
		}
		return id;
	} catch {
		return null;
	}
}

async function post(path, body) {
	const res = await fetch(API + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
	return data;
}

function renderBoard(el, board, mine) {
	el.innerHTML = '';
	board.forEach((v, i) => {
		const slot = document.createElement(mine ? 'button' : 'div');
		slot.className = 'slot' + (v ? ' filled' : '') + (!mine && i === lastAi ? ' last' : '');
		slot.textContent = v || '';
		if (mine) {
			slot.type = 'button';
			slot.disabled = !!v || busy || !game;
			slot.setAttribute('aria-label', v ? `${i + 1}번 칸: ${v}` : `${i + 1}번 칸에 놓기`);
			slot.addEventListener('click', () => place(i));
		}
		el.appendChild(slot);
	});
}

function render() {
	renderBoard($('my-board'), myBoard, true);
	renderBoard($('ai-board'), aiBoard, false);
	$('card').textContent = game && game.card ? game.card : '–';
	$('turn').textContent = `${Math.min(game ? game.turn + 1 : 1, 20)} / 20`;
	$('level-name').textContent = game ? game.levelName : '-';
}

async function start(level) {
	$('start-error').hidden = true;
	try {
		const g = await post('/start', { level, playerId: playerId() });
		game = { ...g };
		myBoard = Array(20).fill(0);
		aiBoard = Array(20).fill(0);
		lastAi = -1;
		$('my-score').textContent = '0';
		$('ai-score').textContent = '0';
		$('start-screen').classList.add('hidden');
		$('end-screen').classList.add('hidden');
		render();
		cardShownAt = performance.now();
	} catch (e) {
		$('start-error').textContent = '게임을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
		$('start-error').hidden = false;
	}
}

async function place(slot) {
	if (busy || !game || myBoard[slot]) return;
	busy = true;
	const card = game.card;
	myBoard[slot] = card;
	$('hint').textContent = 'AI가 생각하는 중…';
	render();
	try {
		const r = await post('/move', {
			token: game.token, slot,
			thinkMs: Math.round(performance.now() - cardShownAt),
		});
		game.token = r.token;   // 게임 상태는 서버가 암호화한 토큰으로 들고 다닌다
		aiBoard[r.aiSlot] = card;
		lastAi = r.aiSlot;
		game.turn = r.turn;
		$('my-score').textContent = r.playerScore;
		$('ai-score').textContent = r.aiScore;
		if (r.finished) {
			game.card = null;
			$('hint').textContent = '게임 끝';
			busy = false;
			render();
			finish(r.playerScore, r.aiScore);
			return;
		}
		game.card = r.nextCard;
		$('hint').textContent = '내 보드의 빈칸을 눌러 놓으세요';
	} catch (e) {
		myBoard[slot] = 0;
		$('hint').textContent = '연결이 끊겼어요. 다시 눌러 주세요.';
	}
	busy = false;
	render();
	cardShownAt = performance.now();
}

function finish(me, ai) {
	$('result-title').textContent = me > ai ? '승리!' : me < ai ? '패배' : '무승부';
	$('final-score').textContent = `나 ${me}점 · AI(${game.levelName}) ${ai}점`;
	$('end-screen').classList.remove('hidden');
}

LEVELS.forEach(({ level, name, avg }) => {
	const b = document.createElement('button');
	b.className = 'btn level-btn';
	b.innerHTML = `<span class="lv-name">${name}</span><span class="lv-avg">AI 평균 ${avg}점</span>`;
	b.addEventListener('click', () => start(level));
	$('levels').appendChild(b);
});
$('again-btn').addEventListener('click', () => start(game.level));
$('level-btn').addEventListener('click', () => {
	$('end-screen').classList.add('hidden');
	$('start-screen').classList.remove('hidden');
});

myBoard = Array(20).fill(0);
aiBoard = Array(20).fill(0);
render();
