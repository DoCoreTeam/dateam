# 04. 완료 기준 — AI 토큰 사용량 모니터링

## 기능 완료 기준 (전항목 ✅ 되어야 Done)

### DB / 인프라
- [ ] `ai_token_logs` 테이블 Supabase에 생성 완료
- [ ] RLS 정책: admin-read + service-insert 정상 동작
- [ ] `org_content` META에 `ai_token_alert_threshold` 필드 존재

### 로깅 레이어
- [ ] 7개 AI 기능 전부 호출 시 `ai_token_logs`에 레코드 삽입됨
- [ ] `feature` 값이 정의된 7개 ID 중 하나로 정확히 저장됨
- [ ] `prompt_tokens`, `output_tokens`, `total_tokens` 모두 0 이상의 정수
- [ ] 로깅 실패 시 AI 기능 본체는 정상 응답 반환 (fire-and-forget 확인)
- [ ] 리드 파싱 시 2건 (parseLeadInput + scoreFit) 각각 저장됨

### 어드민 대시보드
- [ ] `/admin/ai-usage` 경로 접근 가능 (어드민만)
- [ ] SummaryCards: 오늘 / 이번달 / 누적 토큰 수 표시
- [ ] 이번달 임계치 대비 사용률 % 표시
- [ ] 기능별 막대 차트 렌더링 (7개 기능)
- [ ] 일별 사용량 30일 라인 차트
- [ ] 유저별 집계 테이블
- [ ] Raw log 테이블 (페이지네이션)
- [ ] 날짜 범위 필터 동작

### 알림
- [ ] 월간 토큰이 임계치 초과 시 관리자에게 인앱 알림 생성
- [ ] 같은 달에 알림 중복 발송 없음

### 설정
- [ ] `/admin/settings`에 "AI 토큰 알림 임계치" 입력 필드 추가
- [ ] 임계치 저장 후 반영 확인

### UI / UX
- [ ] 모바일(375px) 레이아웃 깨짐 없음 (카드 패턴 / table-card)
- [ ] 사이드바 "AI 사용량" 메뉴 항목 표시
- [ ] 어드민이 아닌 유저 접근 시 403 또는 리다이렉트

### 코드 품질
- [ ] TypeScript 빌드 오류 없음 (`pnpm tsc --noEmit`)
- [ ] ESLint 오류 없음
- [ ] 단위 테스트 3개 (T-UT-01 ~ T-UT-03) 통과
