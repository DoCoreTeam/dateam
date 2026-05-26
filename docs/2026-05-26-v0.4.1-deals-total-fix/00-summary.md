# FAST PATH Summary

작업: 영업기회 "전체 기회" stat 카드 — 스크롤 시 숫자 변하는 버그 수정
대상: apps/web/app/api/deals/route.ts, apps/web/app/(member)/deals/page.tsx
이유: useSWRInfinite의 누적 list.length를 표시해서 스크롤마다 숫자가 증가했음. DB count 쿼리를 추가해 전체 건수를 항상 정확히 표시.
영향: deals 페이지 stat 카드만. contacts/accounts 페이지에 동일 잠재 버그 존재 (후속 권장)
