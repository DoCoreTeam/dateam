#!/bin/bash
# scripts/migrate.sh — 마이그레이션 적용 + 추적 등록 (원자적)
# 사용법: PGPASSWORD='...' ./scripts/migrate.sh <파일명>
#         PGPASSWORD='...' ./scripts/migrate.sh --status
set -euo pipefail

DB_HOST="aws-1-ap-northeast-2.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.tsnlplkslfcwtchzdaai"
DB_NAME="postgres"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../supabase/migrations" && pwd)"

if [ -z "${PGPASSWORD:-}" ]; then
  echo "❌ PGPASSWORD 환경변수를 설정해 주세요"
  exit 1
fi

psql_cmd() {
  /opt/homebrew/bin/psql \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 "$@"
}

if [ "${1:-}" = "--status" ]; then
  echo "=== 마이그레이션 현황 ==="
  applied=$(psql_cmd -t -A \
    -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" \
    2>/dev/null || true)
  for f in "$MIGRATIONS_DIR"/*.sql; do
    filename=$(basename "$f")
    version=$(echo "$filename" | sed 's/_.*//')
    if echo "$applied" | grep -qx "$version"; then
      echo "✅ $filename"
    else
      echo "❌ $filename  ← 미적용"
    fi
  done
  exit 0
fi

if [ -z "${1:-}" ]; then
  echo "사용법: $0 <파일명 또는 경로>"
  echo "        $0 --status"
  exit 1
fi

FILE="$1"
[ ! -f "$FILE" ] && FILE="$MIGRATIONS_DIR/$1"
[ ! -f "$FILE" ] && { echo "❌ 파일을 찾을 수 없습니다: $1"; exit 1; }

filename=$(basename "$FILE")
# 파일명 형식 검증 — 영숫자·언더스코어만 허용하여 injection 차단
if ! echo "$filename" | grep -qE '^[0-9]+[a-z]?_[a-z0-9_]+\.sql$'; then
  echo "❌ 잘못된 파일명 형식: $filename (예: 013_my_feature.sql)"
  exit 1
fi

version=$(echo "$filename" | sed 's/_.*//')
name=$(echo "$filename" | sed 's/^[^_]*_//' | sed 's/\.sql$//')

# 이미 적용됐는지 확인
already=$(psql_cmd -t -A \
  -c "SELECT COUNT(*) FROM supabase_migrations.schema_migrations WHERE version = '$version';" \
  2>/dev/null | tr -d ' ' || echo "0")

if [ "$already" = "1" ]; then
  echo "⚠️  이미 적용됨: $filename (version=$version)"
  exit 0
fi

echo "🔄 적용 중: $filename"

# 마이그레이션 SQL 읽기
MIGRATION_SQL=$(cat "$FILE")

# SQL 실행 + 추적 등록을 단일 트랜잭션으로 처리
printf 'BEGIN;\n%s\nINSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (%s, %s) ON CONFLICT (version) DO NOTHING;\nCOMMIT;\n' \
  "$MIGRATION_SQL" \
  "'$version'" \
  "'$name'" \
  | psql_cmd

echo "✅ 완료: $filename → 추적 등록됨"
