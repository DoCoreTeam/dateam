# 요구사항 — 메모 발견·처리 통합 시스템 v0.6.2
## 배경
메모(daily_logs.entry_type='note')가 계속 쌓이지만 업무와 연결 안 되면 묻힘.
## 5대 요구
1. 메모 lifecycle 상태(new/reviewed/actioned)
2. AI(pgvector+Gemini 임베딩) 주제 클러스터링 그룹 필터
3. "확인 안 한 메모" 위젯 — 홈 + 일일업무, 숙성도 색상(당일🟢/2-3일🟡/4일+🔴)
4. 메모→업무 승격(promote)
5. 주간보고 작성 시 미처리 메모 리뷰 nudge
## 비기능
- 임베딩 비용: note 작성/수정 시 1회만
- RLS 본인+admin 유지
