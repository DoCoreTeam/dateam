# 02. 태스크 분해 — AI 토큰 사용량 모니터링

## Phase 1: DB + 인프라 (🟩 DC-DEV-DB)

### T1-1. Supabase 마이그레이션
- 파일: `supabase/migrations/010_ai_token_logs.sql`
- `ai_token_logs` 테이블 생성
- 인덱스 4개 생성
- RLS 정책 2개 (admin read / service insert)
- `org_content` META에 `ai_token_alert_threshold`, `ai_token_alert_sent_month` 기본값 추가

### T1-2. TypeScript 타입 추가
- 파일: `apps/web/types/database.ts`
- `AiTokenLog` 인터페이스 추가
- Gemini 응답 공통 타입 `GeminiResponse` 추가

---

## Phase 2: 로깅 레이어 (🟩 DC-DEV-BE)

### T2-1. `lib/token-logger.ts` 신규 생성
```
기능:
- logTokenUsage(params) — fire-and-forget 비동기 로그
- getMonthlyTotal(adminClient) — 당월 누적 집계
- checkAndAlertThreshold(adminClient) — 임계치 체크 + 알림 삽입
```

### T2-2. `lib/gemini-refine.ts` 수정
- `mergeAndRefineByCategory()` — `usageMetadata` 파싱 + `logTokenUsage` 호출
- `refineWeeklyReport()` — 동일
- feature ID: `weekly-report-refine`, `report-preview-merge`

### T2-3. `lib/gemini-lead.ts` 수정
- `parseLeadInput()` — `usageMetadata` + `logTokenUsage`
- `scoreFit()` — `usageMetadata` + `logTokenUsage`
- feature ID: `lead-parse`, `account-fit-score`

### T2-4. `lib/gemini-content-edit.ts` 수정
- `aiEditContentSection()` — `usageMetadata` + `logTokenUsage`
- feature ID: `content-ai-edit`

### T2-5. API Route 수정 (직접 Gemini 호출하는 것들)
- `app/api/deals/ai-parse/route.ts` — feature ID: `deal-activity-parse`
- `app/api/reports/export/route.ts` — feature ID: `report-export`

---

## Phase 3: 어드민 API (🟩 DC-DEV-BE)

### T3-1. `/api/admin/ai-usage/summary` (GET)
응답:
```json
{
  "today_tokens": 12345,
  "month_tokens": 234567,
  "total_tokens": 1234567,
  "alert_threshold": 1000000,
  "month_usage_pct": 23.4
}
```

### T3-2. `/api/admin/ai-usage/by-feature` (GET)
파라미터: `?from=YYYY-MM-DD&to=YYYY-MM-DD`
응답:
```json
[
  { "feature": "weekly-report-refine", "label": "주간보고 AI 정비", "total_tokens": 45000, "call_count": 12 },
  ...
]
```

### T3-3. `/api/admin/ai-usage/by-user` (GET)
파라미터: `?from=...&to=...&limit=20&offset=0`
응답: 유저별 합계 (name 포함)

### T3-4. `/api/admin/ai-usage/daily` (GET)
파라미터: `?days=30`
응답: 일별 시계열 배열

### T3-5. `/api/admin/ai-usage/logs` (GET)
파라미터: `?page=1&limit=50&feature=&user_id=`
응답: 페이지네이션된 raw log

---

## Phase 4: 어드민 UI (🟩 DC-DEV-FE)

### T4-1. `/admin/ai-usage/page.tsx`
- 서버 컴포넌트
- 어드민 권한 체크
- 초기 summary 데이터 fetch

### T4-2. `AiUsageDashboard.tsx`
클라이언트 컴포넌트 (< 300줄, 내부 분리)

**SummaryCards** — 3개 카드
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 오늘 사용량      │ │ 이번달 사용량    │ │ 누적 사용량      │
│ 12,345 tokens   │ │ 234,567 tokens  │ │ 1,234,567       │
│                 │ │ ████░░ 23.4%    │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                    ↑ 임계치 대비 진행률
```

**FeatureBreakdownChart** — 수평 막대 차트
```
주간보고 AI 정비    ████████████ 45,000 (42%)
리드 파싱          ██████ 22,000 (21%)
보고서 내보내기     ████ 15,000 (14%)
...
```

**DailyUsageChart** — 30일 라인 차트 (날짜 × 토큰)

**UserUsageTable** — 테이블 카드 패턴
```
이름     | 이번달 사용량 | 총 사용량 | 최근 호출
홍길동   | 34,500       | 123,000  | 5분 전
김철수   | 12,300       | 56,000   | 2시간 전
```

**RawLogTable** — 페이지네이션 테이블
```
시각            | 기능          | 유저   | 프롬프트 | 출력   | 합계
2026-05-26 14:23 | 리드 파싱    | 홍길동 | 1,234   | 456   | 1,690
```

### T4-3. 날짜 범위 필터
- 기본: 이번달
- 선택: 7일 / 30일 / 직접 입력

### T4-4. 사이드바 메뉴 추가
- 파일: `apps/web/components/ui/Sidebar.tsx`
- 기존 어드민 메뉴에 `AI 사용량` 항목 추가 (아이콘: `BarChart3`)

---

## Phase 5: 설정 UI (🟩 DC-DEV-FE)

### T5-1. 어드민 설정 페이지 수정
- 파일: `apps/web/app/admin/settings/page.tsx`
- 기존 META 설정 폼에 "AI 토큰 알림 임계치" 항목 추가
- 기본값: 1,000,000 토큰/월
- 입력 타입: number (쉼표 포맷으로 표시)

---

## 구현 순서 (권장)

```
T1-1 (마이그레이션) → T1-2 (타입)
  → T2-1 (token-logger) → T2-2~T2-5 (기존 파일 수정)
    → T3-1~T3-5 (API 엔드포인트)
      → T4-1~T4-4 (어드민 UI)
        → T5-1 (설정 UI)
```

## 예상 파일 변경 수

- 신규: 8개 (마이그레이션 1, lib 1, API 5, 어드민 페이지 2)
- 수정: 8개 (gemini lib 3, api route 2, sidebar 1, settings 1, types 1)
- 총: ~16개 파일
