# FAST PATH — 통합입력→검토대기 즉시반영

## 작업
통합입력(QuoteRegisterTab) 등록 후 검토대기(ReviewTab)에서 새 항목이 새로고침해야 보이던 것 → 즉시 표시.

## 원인
SWRProvider 전역 `revalidateIfStale:false`(영속캐시 우선, 마운트 자동재검증 없음) + ReviewTab pending useSWR 옵션 없음 → 검토대기 탭 진입 시 stale 캐시만 표시·재검증 안 함. commit의 mutate가 너무 일찍 1회 refetch하면 stale로 굳어 전체 새로고침해야 신선.

## 수정
- app/(member)/pricing/gpu/tabs/ReviewTab.tsx: 검토대기 useSWR에 revalidateOnMount:true(+revalidateIfStale:true) → 탭 열 때마다 신선 목록.

## 이유
전역 revalidateIfStale:false는 유지(성능), 쓰기 직후 보는 핵심 목록만 override.

## 영향
ReviewTab만. DB·권한 무관.
