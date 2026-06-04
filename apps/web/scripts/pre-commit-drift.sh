#!/usr/bin/env bash
# R6: 스키마 drift 게이트 (PF6) — 커밋 전 schema-contract.ts ↔ 라이브 DB enum 일치 검증.
# 설치: ln -sf ../../apps/web/scripts/pre-commit-drift.sh .git/hooks/pre-commit  (repo 루트 기준 경로 조정)
# DATABASE_URL 미설정 시 조용히 통과(로컬 환경 비차단). 런타임은 get_schema_digest()로 라이브 인지하므로 보조 안전망.
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[drift] DATABASE_URL 미설정 — 검증 건너뜀(런타임 get_schema_digest로 라이브 인지)."
  exit 0
fi
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/gen-schema-contract.mjs" --check
