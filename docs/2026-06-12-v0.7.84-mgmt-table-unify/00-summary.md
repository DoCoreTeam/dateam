# v0.7.84 — 공급사·경쟁사 관리 탭 표 통일 + 국기

## 작업
공급사 탭(카드그리드)을 경쟁사 탭과 동일한 표(table-card) 패턴으로 통일. 양 탭 이름셀에 국기(countryFlag). competitors에 country 추가.

## 변경
- 마이그089: competitors.country 추가, region 'korea'/'domestic'→'KR' 백필.
- api/pricing/gpu/suppliers/bulk (신규): POST {action:'delete', ids[]} 일괄 소프트삭제 아님(suppliers는 하드삭제)—확정견적 연결 공급사는 차단(기존 단건 409 규칙 일괄 적용).
- api/pricing/gpu/competitors GET/[id]PATCH/POST: country 반영.
- SuppliersTab: 카드그리드→표(table-base table-card)+체크박스+gpu-bulkbar(일괄삭제)+국기. 행클릭→SupplierDetailModal 보존. 검색·추가·배지(수동/통합/겸업/연계)·Tier override 모달 보존.
- CompetitorsTab: 이름셀 국기(countryFlag(country)), 수정모달 country 필드.
- 용어 GPU_TERMS 적용. .gpu-comp-table→공용 .gpu-mgmt-table.

## 검증
tsc0/design/test, Playwright(공급사 표·국기·일괄삭제 가드·행클릭 상세 / 경쟁사 국기·country수정), 원복. DC-QA/SEC/REV.
