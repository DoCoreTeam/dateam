# v0.7.271 — 판매가격표 기본 펼침 + Tier 제거

작업: GPU 판매가격표(`/pricing/catalog`)를 기본 전부 펼침으로 바꾸고 Tier 개념을 화면에서 제거.
대상: `apps/web/app/(member)/pricing/catalog/page.tsx` (단일 파일)
이유: 매번 접힌 그룹을 펼쳐야 했고, Tier 구분이 불필요.

## 변경
- **기본 펼침**: `useCollapsibleGroups(allKeys, false)` (이전 `true` = 기본 접힘).
- **Tier 제거 4곳**:
  1. 그룹핑: Tier→모델 2단계 → **모델 단위 1단계**(`buildModelGroups` 인라인, 첫 등장 순서). TierHeader 제거, 모델 헤더는 T 배지 없는 경량 헤더(ChevronRight + 모델명 + N개 구성).
  2. 필터 바의 `전체/Tier 1/2/3` 세그먼트 제거(+ `tierFilter` 상태 제거).
  3. 테이블 "구분"(Tier 배지) 컬럼 제거 → COL 6→5컬럼.
  4. 행 클릭 복사 텍스트에서 `(Tier N)` 제거.
- 제거된 미사용: `TIER_INFO`, `buildTierModelGroups/tierKey/modelKey`, `TierHeader/ModelHeader` import.

## 영향 / 검증
- 단일 파일. `p.tier` 데이터는 그대로 두되 화면 미표시(다른 페이지·API 무영향).
- tsc clean · eslint clean · design:check 통과.
