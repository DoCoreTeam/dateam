# 보안 정책 SSOT

LOOP.md 7절과 정책 3파일의 「보안 정책」 절이 이 파일을 근거로 함
규칙 본문은 LOOP.md 7절에 있고, 여기에는 **재는 방법**을 둠

## 왜 이 파일이 생겼나

2026-09-13 Supabase 경보가 「표가 공개돼 있다」고 알려 옴
전수로 재 보니 경보가 지목한 것은 여섯 갈래 중 하나였음

| 항목 | 그때 | 지금 |
|---|---|---|
| RLS 꺼진 public 표 | 8 | 0 |
| anon 이 쓰기 권한을 가진 표 | 271 | 0 |
| anon 이 읽을 수 있는 SECURITY DEFINER 뷰 | 7 | 0 |
| `TO public` + `USING (true)` 정책 | 7 | 0 |
| search_path 안 박힌 SECURITY DEFINER 함수 | 4 | 0 |
| 한도 없는 익명 쓰기 창구 | 1 | 0 |

열려 있던 여덟 중 다섯이 `CREATE TABLE ... AS SELECT` 백업 사본
사본은 원본의 RLS 를 안 물려받고, 그 사실이 화면에 드러나는 자리가 없음
그래서 사람 기억이 아니라 가드와 CLI 가 봄

경보가 못 보는 것 셋
- SECURITY DEFINER 뷰 (표가 아니라 뷰라서)
- `TO public USING (true)` 정책 (정책이 있기는 있어서)
- 함수 search_path

## 다섯 줄 세기

종합 감사에서 그대로 실행함, 전부 0 이어야 함

```sql
-- 1 RLS 꺼진 public 표
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 2 anon 이 쓰기 권한을 가진 표
select count(distinct table_name) from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

-- 3 TO public 에 USING (true) 인 정책
select count(*) from pg_policies
where schemaname = 'public' and 'public' = any(roles) and qual = 'true';

-- 4 search_path 가 안 박힌 SECURITY DEFINER 함수
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (p.proconfig is null
       or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));

-- 5 anon 이 읽을 수 있는 SECURITY DEFINER 뷰
select count(*) from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public' and g.grantee = 'anon'
  and g.privilege_type = 'SELECT' and c.relkind = 'v';
```

돌리는 법

```bash
PGPASSWORD='...' psql "$DB_URL" -t -A -f docs/policy/security-count.sql
```

익명 키로 실제 찔러 보는 확인 (숫자보다 이쪽이 정확함)

```bash
ANON=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY apps/web/.env.local | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$SUPABASE_URL/rest/v1/<표>" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' -d '{}'      # 401 이어야 함
```

## 가드 네 벌

문서는 안 읽히고 가드는 안 읽혀도 돎

| 가드 | 무엇을 막나 |
|---|---|
| `apps/web/lib/policy/rls-baseline.test.ts` | 잠금 없이 만든 표, 새 `TO public USING (true)` 정책 |
| `apps/web/lib/policy/api-auth-surface.test.ts` | 게이트 없는 라우트, 열어 둔 창구의 속도 제한 누락 |
| `apps/web/lib/policy/security-headers.test.ts` | 응답 헤더 누락, 강제 CSP 의 `unsafe-inline` |
| `apps/web/lib/policy/security-code.test.ts` | sanitize 안 거친 HTML 주입, 안전하지 않은 외부 요청, 코드에 박힌 비밀 |

`scripts/loop.mjs` 의 `plan check` 는 보안에 닿는 범위를 가진 항목이
감사 기준에 보안 줄을 안 가지면 플랜을 통과시키지 않음
`loop start` 는 그 항목에 착수할 때 물어야 할 것을 출력함

## 아직 안 된 것

- CSP 가 Report-Only, 강제하려면 요청마다 nonce 가 필요하고 정적 최적화가 꺼짐
- 서비스롤 키 회전 절차 없음, 지금 방어는 `import 'server-only'` 한 줄
- 로그인 시도 횟수를 우리가 안 셈 (Supabase 기본값)
- 백업 표 여섯 개가 남아 있음, 삭제는 되돌릴 수 없어 승인 대기
- Next.js 14.2.29 에 미인증 원격 코드 실행 두 건, 이미지 최적화 경로가 문제
