# 00 Requirements — GPU 가격정책 일관성 + 전체 CRUD + SSOT cascade

## 배경
GPU 가격정책 모듈은 현재 "통합입력(AI 추출→검토확정)" 단방향으로만 데이터가 들어가고, 개별 CRUD가 없다. 또한 "1·2·4·8장 구성 강제" 정책이 일부 입력경로(AI 검토확정)에만 누락되어, 가격표에 x3 같은 비표준 구성이 섞여 일관성이 깨진다.

## 사용자 결정 (확정)
1. **비표준 x3 처리** = 다음 표준단 **올림** + 가격 **1장 환산** (x3→x4, 1장당 단가×표준수량). [DECISION-x3-policy]
2. **CRUD 범위** = **4탭 전부**. 통합입력으로 들어간 모든 값 개별 수정/삭제 가능. [DECISION-crud-scope]

## 기능 요구사항
- FR1: 모든 입력경로에서 gpu_count를 표준 사다리(1·2·4·8)로 정규화(올림). 1장 환산으로 빠진 단/올림단 가격 산출.
- FR2: 가격표는 1·2·4·8만 표시. 비표준 노출 0.
- FR3: 4탭 엔티티 전부 CRUD — supply_quotes, direct_prices, gpu_products, competitor_market_prices/mapping, availability_responses, direct_pool_stock, suppliers, partner_tiers, pricing_settings(U).
- FR4: 한 곳 수정 → 참조하는 모든 탭·파생값 자동 반영. settings/fx 변경 stale 0.
- FR5: 통합입력으로 들어간 데이터를 사후 편집/삭제 가능.

## 비기능 요구사항 (가드레일)
- NFR1: 소프트 삭제(deleted_at) + 참조 검사. 하드삭제 금지.
- NFR2: admin 게이트 + audit log(actor/time/before/after).
- NFR3: DB CHECK 또는 정규화로 1·2·4·8 강제.
- NFR4: 변경 영향 프리뷰(N건).
- NFR5: 반응형/디자인토큰/테이블카드(CLAUDE.md). RLS 유지(service_role 쓰기 패턴).
- NFR6: 기존 SSOT 패턴 재사용, 신규 추상화 최소.

## 범위 제외
- 시장가 외부 수집기 변경(기존 import 유지). 신규 가격 알고리즘 도입.
- git push / npm publish (커밋까지만).
