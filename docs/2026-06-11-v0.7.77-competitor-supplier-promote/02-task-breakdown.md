# 02 작업 분해 (v0.7.77)

## DB
- 마이그084: `chk_suppliers_source` DROP/ADD로 'competitor_link' 추가(멱등). psql 적용.

## 백엔드
- 신규 `app/api/pricing/gpu/market/competitors/[id]/promote-supplier/route.ts` (POST, admin)
  - 멱등(이미 연결/동명 재사용), supplier-create 재사용, audit, revalidate.
- `app/api/pricing/gpu/suppliers/route.ts` GET — 역방향 competitors 조회 → is_competitor/linked_competitor_name.
- 공개 API 비노출 확인(v1/suppliers·market).

## 프론트
- `tabs/MarketTab.tsx` SupplierLinkControl — 미연결 시 "공급사로 지정" 1클릭 버튼(promote) 추가, 기존 드롭다운 병존(고급: 기존 supplier에 연결).
- `tabs/SuppliersTab.tsx` — SupplierStats 타입 + "경쟁사 겸업" 뱃지(linked_competitor_name).
- 콕핏/시장비교 경쟁가↔판매가 동시·출처배지 유지 확인.

## 검증
- tsc/design/test, Playwright E2E(지정→겸업뱃지→인입→판매가→원복), DC-QA/SEC/REV, 버전 4파일+commit.
