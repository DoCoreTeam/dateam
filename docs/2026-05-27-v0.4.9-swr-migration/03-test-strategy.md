# Test Strategy
- tsc --noEmit 통과 확인
- SWR 캐시 hit 동작: 같은 날짜 재방문 시 loading 없이 즉각 표시
- mutation 후 revalidate: 추가/수정/삭제 후 목록 갱신 확인
