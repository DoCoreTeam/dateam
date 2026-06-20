# FAST PATH Summary — v0.7.222

작업: 핵심 가격-지정(is_selected) 결정 로직에 기본 단위테스트 추가(회귀 보호).
대상:
- lib/gpu/unified-cost-pick.ts (신규) — 자기완결 순수 모듈: pickSupplyCostKrw / pickListSupplierName / pickCostSupplierName
- lib/gpu/cockpit-to-unified.ts — 인라인 `??` 식 3곳을 위 함수로 교체(behavior-preserving 추출, SSOT)
- lib/gpu/unified-cost-pick.test.ts (신규) — 9 테스트
- package.json — test 목록 등록

이유: 세션 내 핵심 수정(supply_cost=cost_basis 지정반영 / supplier_name=effective 공급사)이 Playwright 수동검증만 있었고 단위테스트 부재. node:test는 자기완결 모듈만 실행 가능(pricing.ts·unified-price-pick.ts 전례)이라 cockpit-to-unified 직접 테스트 불가 → 순수 결정로직 추출 후 테스트(레포 기존 패턴).

보호 대상 사고: 지정 NHN인데 리스트가 최저가 Equinix 표시 / 기준 공급원가가 만료 최저가로 계산.

영향: cockpit-to-unified 동작 불변(순수 추출). 전체 401/401(+9), tsc 0, design:check 통과.
