# 00. 요구사항 — AI 토큰 사용량 모니터링

## 배경 / 목적

newAX 시스템에는 현재 7개의 Gemini AI 기능이 운영 중이다.
AI 사용량이 늘어남에 따라 관리자가 토큰 소비를 추적하고 비용을 예측할 수 있어야 한다.

## 현재 AI 기능 목록 (v0.3.x 기준)

| 기능 ID | 이름 | 엔드포인트 | Gemini 호출 횟수 |
|---------|------|-----------|----------------|
| `weekly-report-refine` | 주간보고 AI 정비 | `POST /api/weekly-report/refine` | 1회 |
| `report-preview-merge` | 주간보고 병합 미리보기 | `GET /api/reports/preview` | 1회 |
| `report-export` | 주간보고 DOCX 내보내기 | `POST /api/reports/export` | 1회 |
| `lead-parse` | 리드 인테이크 파싱 | `POST /api/leads/parse` | 2회 (파싱 + fit score) |
| `deal-activity-parse` | 딜 활동 AI 요약 | `POST /api/deals/ai-parse` | 1회 |
| `account-fit-score` | 거래처 적합도 점수 | `POST /api/accounts/fit-score` | 1회 |
| `content-ai-edit` | 콘텐츠 AI 편집 | `POST /api/content/ai-edit` | 1회 |

> 모든 AI 호출은 서버사이드(Next.js API Route) 에서만 발생 — 클라이언트 직접 호출 없음

## 핵심 요구사항

### FR-01: 토큰 로깅
- Gemini API 응답 내 `usageMetadata` 파싱 (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`)
- 7개 기능 전체 로깅 (누락 없음)
- 로그 보존 기간: 무기한

### FR-02: 집계 단위 (4단계)
1. **전체 합계** — 일별 / 월별 / 누적 총량
2. **기능별** — 7개 기능 중 어느 기능이 토큰을 많이 쓰는지
3. **유저별** — 특정 유저의 소비량 (남용 감지)
4. **요청 단위 로그** — 각 API 호출 기록 (raw log)

### FR-03: 어드민 대시보드
- 경로: `/admin/ai-usage`
- 기존 어드민 사이드바에 메뉴 추가
- 반응형 (기존 CLAUDE.md 정책 준수)
- RLS: admin 역할만 접근 가능

### FR-04: 알림
- 월간 총 토큰이 설정된 임계치 초과 시 관리자에게 알림
- 임계치는 관리자 설정 페이지에서 변경 가능 (기본값: 1,000,000 tokens/월)
- 알림 채널: 인앱 알림 (우선), 추후 이메일 확장 가능

### FR-05: 설정
- 현재 어드민 설정 페이지(`/admin/settings`)에 토큰 알림 임계치 항목 추가

## 비기능 요구사항

- 로깅 실패가 AI 기능 자체를 막으면 안 됨 (fire-and-forget / 비동기)
- 토큰 로깅으로 인한 응답 지연 최소화 (< 5ms 오버헤드 목표)
- 기존 Gemini 호출 함수에 최소한의 변경

## 제외 범위

- 실시간 스트리밍 모니터링 (WebSocket/SSE)
- 자동 비용 계산 (단가 × 토큰 — Gemini 요금 변동 있어 수동 참조)
- 외부 결제 API 연동
