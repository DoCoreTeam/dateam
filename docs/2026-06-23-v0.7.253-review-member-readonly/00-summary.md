# 검토대기 member 조회+삭제 한정 + 안내문구 간결화 — v0.7.253 (FAST)

## 작업
검토대기 탭에서 비관리자(member)는 **조회 + 일괄삭제만** 가능하게 — 확정·가격표반영·반려·일괄확정·AI재분석 버튼 숨김.
끝에 403 내지 말고 **사전에 버튼 숨김**. 상단 배너 member에겐 "관리자가 승인하면 확정 반영됩니다."로 간결화.

## 대상
- `app/api/pricing/gpu/review/bulk/route.ts`: requireAdminApi→requireMemberApi. action='confirm'은 admin 전용(role 가드 403), action='delete'는 member 허용(검토대기 정리·가격무영향).
- `tabs/ReviewTab.tsx`: isAdmin prop. member는 ReviewCard 확정/반려·AI재분석·90%경고 숨김, 상단 일괄확정 숨김. 배너 role 분기.
- `GpuPricingClient.tsx`: <ReviewTab isAdmin={isAdmin}>.
- `intake-permission.test.ts`: review/bulk를 member게이트+confirm 내부 admin한정으로 가드 갱신.

## 이유
v0.7.246 게이트가 review/bulk(confirm·delete)를 통째 admin전용으로 둬서 member가 검토대기에서 아무것도 못하고 끝에 403.

## 영향/한계
- member 삭제는 review_items 소유자 컬럼이 없어 pending 항목 범위(가격무영향). admin confirm/반려는 현행.
- 560 테스트·tsc0·design·next build·권한가드 4/4.
