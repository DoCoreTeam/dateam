# 04 — Completion Criteria

## 선결 (Sprint 0)
- [ ] 720/730 코드 전역 단일화 — `lib/gpu/hours.ts` SSOT, 잔존 리터럴 0(grep 검증).
- [ ] 골든셋:116 번들 정답 폐기 → classify와 정합(밴드 제외 기대값).
- [ ] market/refresh: AI 나눗셈 지시 제거·코드 산술 전환, 15k 절단→fetchUrlText SSOT.

## 무손실 (핵심)
- [ ] 소프트뱅크 5요금 전량 저장: 월정액 3(flat) + 시간제 3성분(base_fee 30,000/월·usage 7.2円/1分·storage 1,000/100GB) — 성분 소실 0.
- [ ] GB200 가격 ≠ $0.00 (전각 ￥ 정규화).
- [ ] reconciliation: 스냅샷 통화토큰 미커버 시 자동확정 차단·명시 노출(은폐 0). 스펙숫자 오탐 0.

## 신규 엔티티 (market_price_components) — Feature Defaults
- [ ] 마이그 165 append-only + **RLS(owner/서비스롤, default-deny)**.
- [ ] 저장(C)/조회(R) 경로 — 관측 CRUD는 append+소프트무효(하드삭제 금지, 감사).
- [ ] List/조회: 콕핏·market이 components 기반 최신뷰(is_latest) 조회. 요금구조별 분리.
- [ ] 하위호환: 기존 obs_* NULL 허용, 기존 행 무손상.

## 무오염 (비교 타당성)
- [ ] 번들(flat) vs 순수(usage) 밴드 별도 트랙 — 혼입 0.
- [ ] 시나리오 실효비용 결정론 파생(기본료+종량+스토리지 합산) — 단위테스트 통과.
- [ ] tax unknown·stale = 밴드 제외 또는 명시 플래그.

## 활성 경로 (CLAUDE.md 정책)
- [ ] review/stream(수동)·market/refresh(자동) **둘 다** 신규 결정론추출+components+reconciliation 경유 — 죽은/옛 경로 0(grep).

## 게이트
- [ ] tsc 0 · 전체 node:test green(신규 파일 package.json 등록) · design:check 통과.
- [ ] Playwright 실화면: 소프트뱅크 5요금 전량 + GB200≠$0 확인.
- [ ] 🟥 DC-QA/DC-SEC/DC-REV PASS.
