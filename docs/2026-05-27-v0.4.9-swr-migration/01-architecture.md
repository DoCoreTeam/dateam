# Architecture — SWR Migration

## Before
Client → Server Action → Supabase (매 방문 waterfall)

## After
Client → SWR Cache → (hit) 즉각 표시
                   → (miss) API Route → Supabase → SWR Cache 저장

## API Routes (신규)
- GET /api/daily/logs?date=YYYY-MM-DD → DailyLog[]
- GET /api/daily/carryover?today=YYYY-MM-DD → DailyLog[]
- GET /api/daily/week?start=YYYY-MM-DD → DailyLog[]
- GET /api/calendar/month?year=YYYY&month=M → DayLogSummary[]

## SWR 설정 (기존 SWRProvider 그대로)
revalidateOnFocus: false, dedupingInterval: 5000ms
