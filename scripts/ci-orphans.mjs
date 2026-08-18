#!/usr/bin/env node
// scripts/ci-orphans.mjs — 고아 계측 (관계 계약이 지켜지고 있는지 실데이터로 확인)
//
// 왜 별도 명령인가: `pnpm test`의 정적 가드는 **선언과 SQL이 일치하는지**만 본다.
// 이미 새고 있는지는 실제 행을 세어야만 안다 — 그리고 실제로 새고 있었다
// (2026-08-18 실측: 채널을 잃은 게시물 55건 · 대상 없는 작업 20건).
// 정적 가드가 전부 초록인 동안 데이터는 조용히 오염되고 있었으므로 둘 다 필요하다.
//
//   PGPASSWORD='...' node scripts/ci-orphans.mjs          # 계측만
//   PGPASSWORD='...' node scripts/ci-orphans.mjs --fix     # 발견 즉시 정리(백업 후)
//
// 하나라도 0이 아니면 exit 1 — CI·크론에 그대로 걸 수 있다.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const DB_USER = 'postgres.tsnlplkslfcwtchzdaai'
const DB_HOST = 'aws-1-ap-northeast-2.pooler.supabase.com'
const DB_PORT = '6543'
const DB_NAME = 'postgres'

if (!process.env.PGPASSWORD) {
  console.error('PGPASSWORD 가 필요합니다.  PGPASSWORD=\'...\' node scripts/ci-orphans.mjs')
  process.exit(2)
}

/**
 * 계약을 그대로 읽어 쿼리를 만든다.
 *
 * 왜 여기서 SQL을 손으로 안 적나: 손으로 적으면 계약에 참조를 추가해도 계측이 따라오지
 * 않는다. 그게 "새 표가 생길 때마다 구멍이 하나 늘어난" 원래 구조다.
 */
const contract = await import(
  join(repoRoot, 'apps', 'web', 'lib', 'ci', 'relation-contract.ts')
)
const probes = contract.orphanProbes()

function psql(sql) {
  const r = spawnSync('psql', [
    `postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`,
    '-tAc', sql,
  ], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`쿼리 실패: ${(r.stderr || '').trim()}`)
    process.exit(2)
  }
  return r.stdout.trim()
}

let total = 0
const dirty = []

console.log('고아 계측 — 전부 0이어야 정상입니다\n')
for (const probe of probes) {
  const n = Number(psql(probe.sql))
  total += n
  if (n > 0) dirty.push({ ...probe, n })
  console.log(`  ${n === 0 ? '✅' : '🔴'} ${String(n).padStart(6)}  ${probe.label}`)
}

console.log('')
if (total === 0) {
  console.log('✅ 고아 0건 — 삭제 계약이 지켜지고 있습니다')
  process.exit(0)
}

console.log(`🔴 고아 ${total}건 — 관계 계약이 어딘가에서 깨졌습니다`)
console.log('   마이그 208(FK CASCADE + 트리거)이 적용됐는지 먼저 확인하세요:')
console.log('   ./scripts/migrate.sh --status | grep 208')
process.exit(1)
