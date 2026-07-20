# 03 — Test Strategy

## 단위 (node:test — package.json test 목록에 추가 필수)
- `hours.test.ts` — 720/730 SSOT 단일값, 전 소비 경로 동일 결과.
- `price-components.test.ts` — 소프트뱅크 5요금 → 5 components(월정액 3 flat + 시간제 base_fee/usage/storage 3) 무손실 매핑. 성분 0 소실 assert.
- `deterministic-table.test.ts` — 파이프표(전각 ￥ 포함) 정확 파싱, 라벨산문 정규식(30,000円·7.2円/1分·1,000円/100GB) 추출.
- `reconciliation.test.ts` — 스냅샷 원문 통화토큰 전수스캔 커버리지: 미추출 성분 반드시 "미커버"로 검출(은폐 0). 스펙숫자(640GB·400Gbps) 오탐 0.
- `scenario-cost.test.ts` — 기준 시나리오 실효비용 결정론(기본료+종량+스토리지 합산). 번들 flat은 별도 트랙.
- `validate.test.ts` — 月額基本料金이 reject 아님(base_fee) 회귀 고정.
- `golden-*.test.ts` — 116 번들 정답 교체(밴드 제외 기대), 소프트뱅크 코퍼스 추가.

## 통합
- market/refresh·review/stream 둘 다 신규 경로 경유 확인(옛 경로 잔존 0). obs/components 채워짐 assert.

## E2E (Playwright — 실화면, 직접 검증)
- 소프트뱅크 URL 통합입력 → 5요금 전량 노출(3 flat + 시간제 3성분) + GB200 가격≠$0 + 미커버 0 또는 명시 검수큐.
- 자동 refresh(?auto=1) 후 components·is_latest 정상.

## 결정론 검증
- 같은 스냅샷 2회 → 동일 결과(결정론 파서 경로). AI 경유분만 비결정 허용하되 reconciliation이 은폐 차단.

## 회귀 게이트
- 검수에서 잡힌 실오류 = 골든 코퍼스 추가 → 단조 증가(수렴). design:check·tsc·전체 test green.
