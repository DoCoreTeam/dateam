# gcube 가격 반영 모니터 (v0.7.70)

## 작업
우리가 정한 "우리 판매가"가 외부 gcube.ai 사이트에 제대로 반영됐는지 매일 자동 확인.

## 배경/결정
- gcube.ai = 외부 별도 사이트(JS 렌더). 우리가 가격 정함 → 사람이 gcube 반영 → 반영 여부를 매일 모니터로 검증.
- 수집 방법: Playwright 헤드리스로 gcube.ai/ko/price 열기 → "가격표" 탭 클릭 → 렌더된 행 파싱.
- 파싱 구조(실측): `TIER1 B200 x 1 / 180GB vCPU26Memory360GBStorage2815GB 10,500원 ~ 15,000원/hr`
  → 모델명 / 장수(x N) / 메모리 / 가격범위(저~고 원/hr). 모델명+장수로 우리 gpu_products 매칭.

## 구성
- DB: gcube_price_checks 테이블(이력) + gpu_products에 최신 상태 캐시(선택)
- 파서: scripts/gcube-price-check.mjs (Playwright) → 파싱→매칭→우리판매가 비교→checks 기록
- API: GET /api/pricing/gpu/gcube-check (상품별 최신 결과)
- UI: 콕핏에 "gcube 반영" 상태 — ✅일치 / ⚠️불일치(우리 X ↔ gcube 저~고) / ❓확인안됨 + 마지막 확인
- 크론: .github/workflows GitHub Actions 매일 1회(사용자 시크릿 설정 후 동작)

## 비교 규칙
우리 판매가가 gcube [저~고] 범위 안 → 일치 / 벗어남 → 불일치 / 매칭 안 됨 → 확인안됨. 두 값 다 표시해 사용자 판단.

## 제약
- 스크래핑 숙명(구조 변경 시 깨질 수 있음) → 실패 시 "확인안됨" 안전 처리 + 로깅.
- 기존 가격 SSOT 불변. git push 금지(커밋까지).
