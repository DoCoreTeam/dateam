# Requirements — daily·calendar SWR Migration
문제: daily/calendar가 useEffect+Server Actions으로 매 방문마다 재요청
목표: SWR 캐시 도입으로 재방문 시 즉각 표시
변경 범위: 읽기 전용 4개 함수 → API Route + SWR (쓰기는 Server Actions 유지)
