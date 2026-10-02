"""Aimbooster 엠블럼: 종이 과녁(PixelLab) 둘레에 게임과 똑같은 타이머 링을 그려 9프레임으로 만든다.

링은 aimbooster-unity 의 Assets/Shaders/Target.shader 와 같은 규칙으로 찍는다:
  - 과녁 반지름을 1 로 놓고 1.1 ~ 1.2 사이가 링, 그 안팎 1픽셀은 어두운 테두리
  - 12시에서 시계 방향으로 남은 만큼만 진한 앰버(#FFC733), 지나간 쪽은 25% 로 흐리게
  - 픽셀 가운데에서 재므로 도트가 정수 칸에 맞는다
프레임 0 은 링이 가득, 프레임 8 은 다 빠진 링. CSS 가 alternate 로 돌리므로 줄었다가 다시 찬다.

    python tools/emblem-timer.py target.png out_dir/
    python tools/emblem-sheet.py public/art/emblem-aimbooster.png out_dir/f0.png ... out_dir/f8.png
"""

import math
import os
import sys
from PIL import Image

FRAMES = 9
TIMER = (255, 199, 51)          # 셰이더 _Timer (1, 0.78, 0.2)
EDGE = (31, 20, 13, 217)        # 셰이더 _Edge (0.12, 0.08, 0.05, 0.85)
TIMER_IN, TIMER_OUT = 1.1, 1.2  # 과녁 반지름 대비
DRAINED_ALPHA = 0.25


def frame(target, radius, size, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    c = size / 2
    px = img.load()
    for y in range(size):
        for x in range(size):
            dx, dy = (x + 0.5 - c) / radius, (c - (y + 0.5)) / radius
            r = math.hypot(dx, dy)
            if TIMER_IN <= r < TIMER_OUT:
                turn = (math.atan2(dx, dy) / (2 * math.pi)) % 1   # 12시 0 → 시계 방향 1
                a = 1 if turn <= fill else DRAINED_ALPHA
                px[x, y] = (*TIMER, round(255 * a))
            elif TIMER_IN - 1 / radius <= r < TIMER_OUT + 1 / radius:
                px[x, y] = EDGE
    off = (size - target.width) // 2
    img.alpha_composite(target, (off, off))
    return img


def main(target_path, out_dir):
    target = Image.open(target_path).convert("RGBA")
    left, top, right, bottom = target.getbbox()
    radius = (right - left) / 2
    # 링 바깥 테두리까지 들어가는 가장 작은 짝수 캔버스
    size = math.ceil(2 * (radius * TIMER_OUT + 1)) + 2
    size += size % 2
    os.makedirs(out_dir, exist_ok=True)
    for i in range(FRAMES):
        frame(target, radius, size, 1 - i / (FRAMES - 1)).save(os.path.join(out_dir, f"f{i}.png"))
    print(f"{FRAMES} frames {size}x{size} in {out_dir} (target radius {radius})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
