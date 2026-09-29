---
title: 'STREAMS'
description: '카드 20장을 한 장씩 받아 20칸에 놓아요. 왼쪽부터 작거나 같은 숫자로 길게 이을수록 점수가 커져요. 같은 카드를 받는 AI와 점수를 겨뤄요. 난이도는 5단계.'
shortDescription: '숫자 카드를 길게 이어 AI를 이겨라'
url: '/games/streams/'
type: 'internal'
engine: 'html'
color: 'cyan'
thumb: '🔢'
accent: '#57C7F5'
lettering: 'STR|EAMS'
tags: ['퍼즐', '확률', 'AI 대전']
releaseDate: '2026-09-29'
status: 'published'
---

카드 20장이 한 장씩 나오고, 20칸 중 원하는 곳에 놓아요. 한 번 놓은 카드는 옮길 수 없어요.

## 점수

왼쪽부터 작거나 같은 숫자로 이어지는 구간이 길수록 점수가 커져요. 20칸을 전부 이으면 300점.

## AI

같은 카드를 받는 AI와 겨뤄요. AI는 앞으로 나올 카드를 모르고, 사람과 같은 정보만 보고 둬요.
사람 플레이를 흉내 내는 모델과 강화학습 모델(Gumbel AlphaZero)을 섞어 난이도 5단계를 만들었어요.
