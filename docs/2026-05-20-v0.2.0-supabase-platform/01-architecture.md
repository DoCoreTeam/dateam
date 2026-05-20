# Architecture — newAX v0.2.0

## 스택
- Frontend/Backend: Next.js 14 (App Router, Server Components, Server Actions)
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth (이메일+비밀번호)
- Styling: Tailwind CSS
- Monorepo: pnpm workspaces
- Deploy: Vercel

## 디렉토리 구조
```
newAX/
├── apps/
│   └── web/                        # Next.js 14
│       ├── app/
│       │   ├── (auth)/login/       # 로그인
│       │   ├── (member)/           # 팀원 영역
│       │   │   ├── dashboard/      # 기존 대시보드 이식
│       │   │   ├── routine/        # 일별 루틴 체크
│       │   │   ├── kpi/            # KPI 수치 입력
│       │   │   └── weekly-report/  # 주간보고
│       │   └── admin/              # 어드민 영역
│       │       ├── users/
│       │       ├── reports/
│       │       ├── routine/
│       │       └── kpi/
│       ├── components/
│       └── lib/supabase/
├── supabase/
│   └── migrations/
└── (기존 HTML 파일들 — GitHub Pages 병행)
```

## DB 스키마 (핵심 4 테이블)
- profiles: auth.users 확장, role 포함
- weekly_reports: user_id + week_start + category UNIQUE
- kpi_entries: user_id + metric_name + period
- routine_checks: user_id + routine_name + check_date UNIQUE

## 인증 흐름
로그인 → Supabase JWT → middleware에서 세션 확인 → 미로그인 시 /login 리다이렉트
