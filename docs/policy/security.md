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

## 서비스롤 키 회전

이 키는 RLS 를 통째로 지나간다. 새면 위의 모든 잠금이 무의미해진다

```bash
node scripts/rotate-service-key.mjs          # 바꿔야 하는 곳을 지금 코드에서 세어 보여 줌
node scripts/rotate-service-key.mjs --verify # 바꾼 뒤 새 키가 실제로 도는지 확인
```

바꾸는 곳 넷: Supabase 화면(발급) · Vercel 환경변수(세 환경) · GitHub Actions 비밀 · 내 `.env.local`
새 키를 발급하면 **옛 키가 즉시 죽으므로** 나머지 셋을 먼저 준비하고 누름
코드는 고칠 것이 없음, 전부 환경변수에서 읽음

## 처리 기록

| 항목 | 상태 |
|---|---|
| RLS·GRANT·뷰·정책·함수 (마이그 259) | 닫음, 다섯 줄 세기 전부 0 |
| 익명 창구 속도 제한 (마이그 260) | 시간당 5회, 실측 6번째 429 |
| 백업 표 6개 (마이그 261) | CSV 로 뽑아 행 수 대조 후 삭제 |
| 응답 보안 헤더 여섯 | 적용 |
| CSP | **강제**, 요청마다 nonce + strict-dynamic, https 에만 upgrade-insecure-requests |
| 2단계 인증 | TOTP 등록·검증·관리자 해제, 미들웨어 AAL 게이트 |
| Next.js | 14.2.29 → 15.5.25, React 19, 알려진 취약점 critical 2 포함 25건 해소 |
| 이미지 최적화 창구 | 미들웨어에서 404 (안 쓰는 창구는 닫음) |
| 서비스롤 키 회전 | 절차와 확인 스크립트 마련, **키 자체는 사람이 돌림** |

## 아직 안 된 것

- 로그인 시도 횟수를 우리가 안 셈 (Supabase 기본값에 맡김)
- 익명에게 SELECT GRANT 가 스키마 전체에 남아 있음 (`/develop` 브랜딩 조회 때문, RLS 가 막고 있음)
- 서버가 변수 주소로 나가는 fetch 16곳, 기준선으로 얼려 둠 (늘면 실패)
- 남은 의존성 취약점 high 44 · moderate 15 (@xmldom/xmldom · brace-expansion 계열)
