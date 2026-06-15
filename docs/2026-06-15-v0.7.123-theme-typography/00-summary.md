# FAST PATH Summary — 테마 타이포(한글-안전)

작업: 테마 토큰 계약에 **타이포 차원** 추가(레터스페이싱·굵기·라벨 대문자·숫자 모노), mono에 스위스/모노 타이포 정체성 부여. 한글 절대 무손상.

대상:
- `apps/web/app/globals.css` — :root 타이포 토큰 5종 + `[data-theme="mono"]` 오버라이드 + @layer base 배선(숫자 font-variant-numeric, 제목 letter-spacing) + mono `.tape-title/.tape-mini`/eyebrow 토큰화

이유: 사용자 요청 — 테마가 색·형태뿐 아니라 타이포까지 잡되 한글이 깨지지 않게.

한글-안전 근거:
- `font-variant-numeric: tabular-nums` → **숫자에만** 영향(한글 무관) = mono 숫자 등폭/정렬
- `text-transform: uppercase` → **라틴만 대문자화, 한글은 무효(no-op)** = 안전
- letter-spacing/font-weight → 한글에도 자연스러움(과하지 않게)
- **글꼴 자체는 Pretendard 유지**(모노스페이스 라틴 폰트=한글 글리프 없음 → 전역 교체 금지) [[DECISION-20260615-mono-font]]

토큰(:root 중립 기본 → nb/classic 무회귀):
- `--num-variant: normal` / mono `tabular-nums`
- `--label-transform: none` / mono `uppercase`
- `--label-tracking: 0` / mono `0.08em`
- `--label-weight: 600` / mono `600`
- `--heading-tracking: normal` / mono `-0.01em`

영향: nb/classic은 :root 중립값이라 시각 변화 없음(무회귀). mono만 타이포 강화.
검증: tsc · design:check · Playwright 스크린샷(mono 숫자 tabular·라벨 대문자) · 한글 무손상 육안.
