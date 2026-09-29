---
title: 'The STREAMS+'
description: '카드 20장을 한 장씩 받아 20칸에 놓아요. 왼쪽부터 작거나 같은 숫자로 길게 이을수록 점수가 커져요. 같은 카드를 받는 AI와 점수를 겨뤄요. 난이도 5단계와 튜토리얼.'
shortDescription: '숫자 카드를 길게 이어 AI를 이겨라'
url: '/games/streams-unity/'
type: 'internal'
engine: 'unity'
color: 'cyan'
thumb: '🔢'
art: '/art/streams-anim.png'
artFrames: 9
accent: '#12F9CD'
lettering: 'THE|STREAMS+'
emblem: '/art/emblem-streams.png'
tags: ['퍼즐', '확률', 'AI 대전']
releaseDate: '2026-09-30'
status: 'published'
---

카드 20장이 한 장씩 나오고, 20칸 중 원하는 곳에 놓아요. 한 번 놓은 카드는 옮길 수 없어요.
처음이라면 튜토리얼부터 — 고정된 한 판을 두면서 상황마다 코칭을 받아요.

## 점수

왼쪽부터 작거나 같은 숫자로 이어지는 구간이 길수록 점수가 커져요. 20칸을 전부 이으면 300점.
오른쪽 창에서 아직 안 나온 카드와 내 구간, 점수표를 보면서 둘 수 있어요.

## AI

같은 카드를 받는 AI와 겨뤄요. AI는 앞으로 나올 카드를 모르고, 사람과 같은 정보만 보고 둬요.
사람 플레이를 흉내 내는 모델과 강화학습 모델(Gumbel AlphaZero)을 섞어 난이도 5단계를 만들었어요.
