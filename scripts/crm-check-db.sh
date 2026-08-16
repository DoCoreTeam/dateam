#!/bin/bash
# scripts/crm-check-db.sh — CRM 데이터 계층 실DB 검증 게이트 (dacrm T0-03 완료 기준)
#
# 사용법: PGPASSWORD='...' ./scripts/crm-check-db.sh
#
# 하는 일: 마이그레이션 198·199 가 실제로 무엇을 만들었는지 운영 DB 에 직접 물어
#          기대값과 대조한다. 하나라도 어긋나면 비영(non-zero) 종료한다.
# 안 하는 일: 아무것도 쓰지 않는다. 전부 읽기 전용 질의다.
set -euo pipefail

DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.tsnlplkslfcwtchzdaai"
DB_NAME="postgres"

if [ -z "${PGPASSWORD:-}" ]; then
  echo "❌ PGPASSWORD 환경변수를 설정해 주세요"
  exit 1
fi

q() {
  /opt/homebrew/bin/psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -t -A -v ON_ERROR_STOP=1 -c "$1"
}

fail=0
check() { # check <설명> <기대값> <실제값>
  if [ "$2" = "$3" ]; then
    printf '✅ %-46s %s\n' "$1" "$3"
  else
    printf '❌ %-46s 기대 %s / 실제 %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

echo "=== CRM 데이터 계층 검증 (198_crm_core · 199_crm_rls_check) ==="

check "crm_ 테이블 수" 24 \
  "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'crm\\_%' AND table_type='BASE TABLE';")"

check "Crm enum 타입 수" 16 \
  "$(q "SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' AND t.typname LIKE 'Crm%';")"

check "RLS 활성 테이블 수" 24 \
  "$(q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'crm\\_%' AND rowsecurity;")"

check "FORCE RLS 테이블 수" 24 \
  "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'crm\\_%' AND c.relkind='r' AND c.relforcerowsecurity;")"

check "테넌트 정책 수 (테이블당 1개)" 24 \
  "$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'crm\\_%';")"

check "정책 없는 crm 테이블 수" 0 \
  "$(q "SELECT count(*) FROM pg_tables t WHERE t.schemaname='public' AND t.tablename LIKE 'crm\\_%' AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename);")"

# 명세 2.3-2 의 CHECK 4종 — 이름으로 존재를 확인한다
check "CHECK 제약 4종 (chk_seg_time/won/lost/budget)" 4 \
  "$(q "SELECT count(*) FROM pg_constraint WHERE contype='c' AND conname IN ('chk_seg_time','chk_won','chk_lost','chk_budget');")"

check "anon·authenticated 의 crm 테이블 권한 (회수 확인)" 0 \
  "$(q "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'crm\\_%' AND grantee IN ('anon','authenticated');")"

# 호스트 무손상 — CRM 도입 전 205개 + CRM 24개 = 229개 이상이어야 한다(이후 호스트가 늘 수는 있다)
host_ok=$(q "SELECT CASE WHEN count(*) >= 205 THEN 'ok' ELSE 'lost' END FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE 'crm\\_%';")
check "호스트 기존 테이블 무손상 (>=205)" "ok" "$host_ok"

echo
if [ "$fail" -eq 0 ]; then
  echo "🎉 전부 통과"
else
  echo "💥 실패 항목이 있습니다"
fi
exit "$fail"
