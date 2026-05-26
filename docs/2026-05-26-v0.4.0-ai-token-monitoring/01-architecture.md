# 01. 아키텍처 — AI 토큰 사용량 모니터링

## 전체 흐름

```
[사용자 액션]
     │
     ▼
[Next.js API Route]
     │  AI 기능 처리
     │
     ▼
[Gemini REST API] ──── 응답 ────► [usageMetadata 추출]
                                        │
                                        ▼
                               [logTokenUsage() 호출]  ← fire-and-forget (await 없음)
                                        │
                                        ▼
                              [Supabase: ai_token_logs 삽입]
                                        │
                                        ▼
                              [월간 집계 체크 + 임계치 초과 시 알림]
```

## DB 스키마: `ai_token_logs`

```sql
CREATE TABLE ai_token_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- 호출 컨텍스트
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature         text NOT NULL,   -- 기능 ID (위 FR-01 목록)
  model           text NOT NULL,   -- 실제 사용된 Gemini 모델명

  -- 토큰 수
  prompt_tokens   int NOT NULL DEFAULT 0,
  output_tokens   int NOT NULL DEFAULT 0,
  total_tokens    int NOT NULL DEFAULT 0,

  -- 메타
  success         boolean NOT NULL DEFAULT true,
  error_message   text
);

-- 인덱스
CREATE INDEX idx_ai_token_logs_user    ON ai_token_logs(user_id);
CREATE INDEX idx_ai_token_logs_feature ON ai_token_logs(feature);
CREATE INDEX idx_ai_token_logs_created ON ai_token_logs(created_at DESC);
CREATE INDEX idx_ai_token_logs_month   ON ai_token_logs(date_trunc('month', created_at));

-- RLS
ALTER TABLE ai_token_logs ENABLE ROW LEVEL SECURITY;

-- 어드민만 읽기
CREATE POLICY "admin_read_token_logs" ON ai_token_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Service Role만 삽입 (API Route에서 adminClient 사용)
CREATE POLICY "service_insert_token_logs" ON ai_token_logs
  FOR INSERT WITH CHECK (true);  -- adminClient(service_role)는 RLS 우회
```

## `org_content` META 키 추가 (알림 설정)

기존 META JSON에 아래 필드 추가:

```json
{
  "gemini_api_key": "...",
  "gemini_model": "gemini-2.0-flash",
  "ai_token_alert_threshold": 1000000,
  "ai_token_alert_sent_month": "2026-05"
}
```

## 로깅 레이어: `lib/token-logger.ts` (신규)

```typescript
// 역할: Gemini 응답에서 usageMetadata를 추출해 DB에 비동기 저장
// fire-and-forget: 실패해도 AI 기능 본체에 영향 없음

interface TokenUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

export function logTokenUsage(params: {
  userId: string | null
  feature: string
  model: string
  usage: TokenUsage
  success: boolean
  errorMessage?: string
}): void {
  // await 없이 호출 — 로깅 실패는 무시
  logAsync(params).catch(() => {})
}
```

## Gemini 응답 타입 확장

현재 모든 Gemini 호출에서 응답 타입을 아래로 통일:

```typescript
interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[]
    }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}
```

## 어드민 페이지 구조: `/admin/ai-usage`

```
/admin/ai-usage
├── page.tsx                    — 서버 컴포넌트 (초기 데이터 fetch)
└── AiUsageDashboard.tsx        — 클라이언트 컴포넌트 (차트/필터)
    ├── SummaryCards            — 오늘/이번달/누적 총 토큰
    ├── FeatureBreakdownChart   — 기능별 토큰 비율 (막대/도넛)
    ├── DailyUsageChart         — 일별 사용량 추이 (라인 차트)
    ├── UserUsageTable          — 유저별 집계 테이블
    └── RawLogTable             — 요청 단위 로그 (페이지네이션)
```

## API 엔드포인트 (신규)

```
GET  /api/admin/ai-usage/summary    — 요약 카드 데이터
GET  /api/admin/ai-usage/by-feature — 기능별 집계
GET  /api/admin/ai-usage/by-user    — 유저별 집계
GET  /api/admin/ai-usage/daily      — 일별 시계열
GET  /api/admin/ai-usage/logs       — raw log 목록 (page, limit, feature, user_id)
```

## 알림 흐름

```
logTokenUsage() 호출 후 →
  월간 총 토큰 합산 (DB 집계) →
    임계치 초과? →
      ai_token_alert_sent_month == 현재월? → 이미 보냄 → skip
      아니면 → 인앱 알림 insert + META 업데이트(ai_token_alert_sent_month)
```

## 수정이 필요한 기존 파일

| 파일 | 변경 내용 |
|------|----------|
| `lib/gemini-refine.ts` | `usageMetadata` 타입 추가 + `logTokenUsage` 호출 |
| `lib/gemini-lead.ts` | 동일 |
| `lib/gemini-content-edit.ts` | 동일 |
| `app/api/deals/ai-parse/route.ts` | `logTokenUsage` 호출 |
| `app/api/reports/preview/route.ts` | `logTokenUsage` 호출 |
| `app/api/reports/export/route.ts` | `logTokenUsage` 호출 |
| `app/admin/settings/page.tsx` | 임계치 설정 UI 추가 |
| `components/ui/Sidebar.tsx` | AI 사용량 메뉴 항목 추가 |
| `supabase/migrations/` | `ai_token_logs` 마이그레이션 추가 |
