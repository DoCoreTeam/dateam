# 01 Architecture — Performance Optimization

## DB Layer
- 마이그레이션 014: profiles 부분인덱스 + ai_token_logs 복합인덱스
- profiles.deleted_at IS NULL → partial index (RLS 전체 영향)
- ai_token_logs(user_id, feature, created_at DESC) composite index

## API Layer
### ai-usage/summary
- 기존: 전체 rows 로드 후 JS reduce
- 변경: PostgREST aggregate `.select('total_tokens.sum()')` — DB 레벨 SUM

### ai-usage/by-user, by-feature
- 기존: 전체 rows 로드 후 JS groupBy
- 변경: 인덱스 추가 + LIMIT 5000 (날짜 필터 + 인덱스로 실제 스캔 최소화)

### [id] routes (accounts/contacts/deals)
- 기존: createAdminClient (RLS 우회)
- 변경: createClient (RLS 적용, select_all 정책으로 팀원 전체 읽기 가능)
- PATCH/DELETE: createAdminClient 유지 (어드민도 수정 가능해야 함)

### 목록 GET routes (신규 추가)
- cursor 기반 페이지네이션: limit=20, cursor=last_created_at
- accounts/contacts/deals 각각 GET 추가

## Frontend Layer
- SWR 설치 (swr@latest)
- SWRConfig → (member)/layout.tsx에 주입
- accounts/contacts/deals page → 'use client' + useSWRInfinite
- IntersectionObserver로 무한스크롤 트리거
- 어드민 AI usage → useSWR + refreshInterval: 30000
