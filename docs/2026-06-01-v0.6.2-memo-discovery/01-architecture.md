# 아키텍처
## DB (042_memo_discovery.sql)
- CREATE EXTENSION vector
- daily_logs += memo_status text, memo_reviewed_at timestamptz, embedding vector(768)
- ivfflat 인덱스 (cosine)
## 임베딩 흐름
note 작성/수정 → lib/gemini-embedding.embedText() → text-embedding-004 → 768d → daily_logs.embedding
## 클러스터링
GET /api/daily/memos/clusters → note 임베딩 fetch → 그리디 코사인(임계 0.78) 클러스터 → 대표문 모아 Gemini 1콜 배치 라벨링 → 응답 캐시(SWR)
## API
- GET /api/daily/memos?status=&cursor=  (note, logged_at DESC)
- GET /api/daily/memos/clusters
- actions: reviewMemo, archiveMemo, promoteMemoToTask
## UI
- UnreviewedMemoWidget (홈+daily 공용)
- MemoListView (daily 3번째 탭) + 클러스터 칩
- MemoPromoteModal
- WeeklyMemoReview (weekly-report)
