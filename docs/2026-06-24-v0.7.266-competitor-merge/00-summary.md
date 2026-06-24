# v0.7.266 — 경쟁사 회사 병합(캐노니컬 + 별칭 SSOT)

## 배경 / 문제
GPU 관리 > 경쟁사 목록에서 **같은 회사가 표기 차이로 중복 행**으로 등장.
- 예: `CLOUDV` ↔ `CLOUDV (Smileserv)`, `Lambda` ↔ `Lambda Labs`
- 원인: 경쟁사 식별이 `competitors.name`에 대한 `ilike()` 단일 매칭뿐. 회사 병합/별칭/캐노니컬 로직 부재. 도메인(`website_url`)은 저장돼 있으나 식별에 미사용.

## 사용자 결정 (Q&A)
1. **병합 판정**: 도메인 우선 자동 + 도메인 없으면 수동 병합. (요청한 "토큰 하나라도 겹치면 병합"은 과병합 위험 — Elice/Kakao/NHN/SaladCloud 가 'Cloud' 공유 → 반려)
2. **표기 보존**: 캐노니컬 1개 + 별칭(aliases) 보존. 별칭으로 향후 자동 흡수.
3. **기존 중복**: 자동 제안 + 사용자 확정 (자동 일괄 병합 금지).
4. **import 재발방지**: resolveCompetitorId SSOT를 import 경로에 적용(도메인·별칭 자동 흡수).

## 변경 파일
- **신규** `apps/web/lib/gpu/resolve-competitor.ts` (SSOT) — 순수 함수:
  - `normalizeDomain(url)` — scheme/www/path 제거 → 등록가능 도메인(co.kr 등 2단계 TLD 처리)
  - `normalizeCompanyName(name)` — 소문자·괄호내용 제거·공백/기호 정리
  - `resolveCompetitorId({name, website_url}, existing[])` — ①도메인 일치 ②정규화이름/별칭 일치 ③없으면 null(자동생성 금지)
  - `findMergeSuggestions(competitors[])` — 도메인/정규화이름 동일 클러스터 → 병합 후보 그룹
  - `planCompetitorMerge(canonical, absorbed, mappingsByComp)` — 매핑 이관 계획(충돌 매핑은 시세 이관 후 비활성), 별칭 합집합
- **신규** `apps/web/lib/gpu/resolve-competitor.test.ts` — node:test (정규화·해소·과병합 방지·충돌 병합)
- **신규** `supabase/migrations/093_competitor_aliases.sql` — `competitors.aliases text[] default '{}'` + GIN 인덱스 (additive, 안전)
- **신규** `apps/web/app/api/pricing/gpu/competitors/merge/route.ts` (POST, **admin 게이트**) — planCompetitorMerge 실행: 매핑 competitor_id 이관 / 충돌 매핑은 market_prices.mapping_id 이관 후 흡수매핑 is_active=false / aliases 합집합 / 흡수 competitor soft-delete(supplier_id 등 결손값은 캐노니컬로 보전)
- **수정** `apps/web/app/api/pricing/gpu/competitors/route.ts` — 응답에 `aliases`, `merge_suggestions`(findMergeSuggestions) 추가
- **수정** `apps/web/lib/gpu/competitor-import.ts` — `ilike(name)` → resolveCompetitorId(도메인·별칭 우선)
- **수정** `apps/web/app/(member)/pricing/gpu/tabs/CompetitorsTab.tsx` — 병합 제안 배너 + 체크박스 선택 병합(이미 행 체크박스 존재) + 별칭 표시

## 병합 알고리즘 (핵심 — 데이터 무결성)
`market_prices`는 `competitor_product_mapping.id`에 매달림(직접 competitor FK 아님).
캐노니컬 C, 흡수 A 병합 시 A의 각 매핑 m에 대해:
- C가 같은 `(gpu_product_id, pricing_model)` 매핑 m'을 **이미 가짐** → m의 `market_prices.mapping_id`를 m'으로 이관 후 m을 `is_active=false`(중복 매핑 차단)
- C에 동일 매핑 **없음** → m의 `competitor_id`를 C로 이관
- aliases(C) = ∪(C.aliases, A.name, A.short_name, A.aliases)
- A.deleted_at = now()
- C의 비어있는 website_url/supplier_id/color는 A 값으로 보전

## 안전장치
- 과병합 방지: 자동 병합은 **도메인 일치만**. 이름 토큰 겹침으로 자동 병합 절대 금지.
- 데이터 수술 로직은 순수 함수(`planCompetitorMerge`)로 분리 → 단위테스트로 충돌/이관 고정.
- 병합 API는 admin 전용(requireAdminApi). 실데이터는 사용자 확정 클릭 시에만 변경.
- 테스트는 throwaway/픽스처로만(운영 데이터 오염 금지).

## 완료 기준
- [ ] resolve-competitor.test.ts 전부 통과(정규화·도메인해소·별칭해소·과병합 방지·충돌 병합 계획)
- [ ] tsc clean / design:check pass
- [ ] 병합 API admin 게이트 확인
- [ ] import 경로 resolveCompetitorId 적용(도메인/별칭 자동 흡수)
- [ ] UI 병합 제안 + 선택 병합 + 별칭 표시 렌더(실제 활성 경로 CompetitorsTab)
- [ ] 마이그레이션 적용(`093_competitor_aliases.sql`)
