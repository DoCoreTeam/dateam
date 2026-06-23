# 경쟁사 반영 member 검토대기 staging — v0.7.251 (FAST)

## 작업
member가 경쟁사 가격 '반영'을 누르면 "권한이 없습니다(관리자 전용)"로 막히던 것 수정.
→ member 제출은 **검토대기(review_items, target=competitor)로 staging** → admin이 검토대기에서 확정 시 market 반영.

## 이유 (근본)
v0.7.246이 2단계 게이트(제출=member·확정=admin)를 만들었으나 **공급가만 검토대기 경로(review/commit)**가 있고,
**경쟁사는 market/import(라이브·admin전용)뿐**이라 member가 경쟁사 반영 시 403. 검토대기 staging 단계 부재.

## 수정
- `app/api/pricing/gpu/market/import/route.ts`: requireAdminApi→requireMemberApi + role 분기.
  member(비admin)=review_items insert(target='competitor', pending), admin=saveCompetitorPrices 라이브(현행).
  기존 confirm-review-item.ts:100이 admin 확정 시 target=competitor → market 반영(인프라 재사용).
- `QuoteRegisterTab.tsx` applyCompetitor: is_test 전송 + staged 응답이면 "검토대기 제출" 메시지·review pending mutate.
- `intake-permission.test.ts`: market/import를 member-게이트 + 내부 admin 라이브반영 한정으로 가드 갱신.

## 영향/검증
- 공급가 흐름·confirm 인프라 무변경(재사용). admin 라이브반영 동작 보존.
- DB 라운드트립(competitor staging insert 적재 확인) · 권한테스트 4/4 · 560 테스트 · tsc0 · next build · design ✅
