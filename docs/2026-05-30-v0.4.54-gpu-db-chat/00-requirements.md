# Requirements — GPU DB Chat

## 기능 요구사항
1. 채팅 입력창에 자연어 질문 입력
2. 내부 DB (supply_quotes, gpu_products, gpu_audit_logs, suppliers 등) 스냅샷 주입 → Gemini 호출
3. AI가 DB 데이터만 근거로 답변 (DB 무관 질문은 거절)
4. 멀티턴: 최근 5턴 history 유지

## 비기능 요구사항
- 응답시간 < 5초 (DB 조회 + Gemini 호출)
- 내부 어드민 전용 (requireAdminApi)
- 토큰 로깅 (logTokenUsage, feature='gpu-db-chat')
