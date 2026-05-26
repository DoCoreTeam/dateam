# 00 Requirements — DB + API + Client Performance Optimization

## 배경
- DC-ANA 점검 결과 62/100 — 데이터 없는데도 체감 느림
- ai_token_logs 풀스캔, profiles 부분인덱스 없음, LIMIT 없는 목록 쿼리

## 요구사항

### DB
- profiles.deleted_at 부분 인덱스 추가 (RLS 전체 영향)
- ai_token_logs composite index (user_id, created_at, feature)

### API
- ai_token_logs 집계: JS reduce → DB SUM/GROUP BY
- accounts/contacts/deals/lead_intakes [id] 라우트: createAdminClient → createClient
- 목록 라우트: cursor 기반 페이지네이션 (limit=20)

### Frontend
- SWR 설치 및 전 페이지 fetch → useSWR 교체
- accounts/contacts/deals 목록: useSWRInfinite 무한스크롤 (20건)
- AI 사용량 어드민: stale-while-revalidate 30s

## 완료 기준
- [ ] typecheck 통과
- [ ] 목록 무한스크롤 동작
- [ ] AI 사용량 DB SUM 집계
- [ ] SWR 캐시 확인 (Network 탭 304/캐시히트)
