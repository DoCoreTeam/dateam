# 02 Task Breakdown

## Sprint 1

### DB (🟩 DC-DEV-DB)
- [ ] supabase/migrations/014_performance_indexes.sql

### BE (🟩 DC-DEV-BE)
- [ ] apps/web/app/api/accounts/route.ts — GET 추가 (limit, cursor)
- [ ] apps/web/app/api/contacts/route.ts — GET 추가
- [ ] apps/web/app/api/deals/route.ts — GET 추가
- [ ] apps/web/app/api/accounts/[id]/route.ts — createClient 교체
- [ ] apps/web/app/api/contacts/[id]/route.ts — createClient 교체
- [ ] apps/web/app/api/deals/[id]/route.ts — createClient 교체
- [ ] apps/web/app/api/admin/ai-usage/summary/route.ts — DB SUM
- [ ] apps/web/app/api/admin/ai-usage/by-user/route.ts — LIMIT 추가
- [ ] apps/web/app/api/admin/ai-usage/by-feature/route.ts — LIMIT 추가

### FE (🟩 DC-DEV-FE)
- [ ] apps/web/package.json — swr 추가
- [ ] apps/web/lib/swr-config.ts — SWR fetcher + global config
- [ ] apps/web/app/(member)/layout.tsx — SWRConfig provider 추가
- [ ] apps/web/app/(member)/accounts/page.tsx — client + useSWRInfinite
- [ ] apps/web/app/(member)/contacts/page.tsx — client + useSWRInfinite
- [ ] apps/web/app/(member)/deals/page.tsx — client + useSWRInfinite
