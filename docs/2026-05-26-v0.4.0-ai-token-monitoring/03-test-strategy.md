# 03. 테스트 전략 — AI 토큰 사용량 모니터링

## 핵심 검증 원칙

> 로깅 레이어가 AI 기능 본체를 절대 방해하지 않아야 한다.
> "로그 실패 → AI 기능 계속 동작" 이 최우선 불변 조건.

---

## 단위 테스트

### T-UT-01: `logTokenUsage` 비동기 격리
- 로깅 DB 삽입이 실패해도 예외가 caller로 전파되지 않음을 확인
- Supabase insert를 mock하여 에러 throw → 함수 정상 완료

### T-UT-02: `usageMetadata` 파싱
- 응답에 `usageMetadata`가 있는 경우: 정확한 값 파싱
- 응답에 `usageMetadata`가 없는 경우 (구 응답 형식): `{promptTokens: 0, outputTokens: 0, total: 0}` 기본값

### T-UT-03: `checkAndAlertThreshold`
- 누적 토큰 < 임계치: 알림 미생성
- 누적 토큰 ≥ 임계치 + 이번 달 첫 초과: 알림 생성 + `ai_token_alert_sent_month` 갱신
- 누적 토큰 ≥ 임계치 + 이미 이번 달 알림 발송됨: 알림 중복 미생성

---

## 통합 테스트

### T-IT-01: 실제 Gemini 호출 후 로그 저장 확인
- `POST /api/weekly-report/refine` 호출
- `ai_token_logs` 테이블에 feature=`weekly-report-refine` 레코드 생성 확인
- `total_tokens > 0` 확인

### T-IT-02: 7개 기능 전체 feature ID 매핑 확인
- 각 AI API 엔드포인트 호출 후 올바른 feature 값으로 로깅되는지 확인

### T-IT-03: 어드민 API 집계 정확성
- 특정 날짜에 N건 삽입 → `/api/admin/ai-usage/daily` 응답의 해당 날 토큰 합산 일치

---

## E2E 테스트

### T-E2E-01: 어드민 대시보드 접근 제어
- 비로그인 상태 → `/admin/ai-usage` → 리다이렉트 (401)
- 일반 유저 로그인 → `/admin/ai-usage` → Forbidden (403)
- 어드민 로그인 → 정상 진입

### T-E2E-02: SummaryCards 렌더링
- 어드민 로그인 후 `/admin/ai-usage` 진입
- 오늘 / 이번달 / 누적 카드 3개 표시 확인
- 숫자 포맷 (쉼표 구분) 확인

### T-E2E-03: 기능별 차트 표시
- 기능별 막대 차트에 7개 기능 레이블 표시 확인

### T-E2E-04: raw log 테이블 페이지네이션
- 50건 이상 데이터 시 다음 페이지 버튼 활성화

---

## 수동 검증 체크리스트 (QA)

- [ ] 주간보고 AI 정비 사용 후 로그 테이블에서 확인
- [ ] 리드 인테이크 입력 후 2건 로그 확인 (parseLeadInput + scoreFit)
- [ ] 관리자 토큰 임계치 1으로 설정 → AI 기능 1회 사용 → 알림 확인
- [ ] 모바일(375px)에서 대시보드 카드 레이아웃 확인
- [ ] 어드민 사이드바 "AI 사용량" 메뉴 노출 확인
