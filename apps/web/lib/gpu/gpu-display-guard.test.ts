import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 정적 가드 — GPU 표시 계층의 SSOT 우회(같은 값이 화면마다 다르게 보이는 사고)를 재유입 차단한다.
// (설계 헌법 제5조 표시 일관성·제6조 원본통화 표시)
//
// 1) 공급/견적 금액 표시는 원본통화 SSOT(fmtMoneyFromOriginal / fmtMoneyFromKrw / fmtMoneyFromUsd)를 거친다.
//    특정 화면이 fmtUSD 하드코딩으로 견적 단가를 무조건 달러로 찍으면(과거 사고) 실패.
// 2) 등급 잠금 컬럼(tier_locked) 마이그레이션이 존재해야 한다(자동판정이 수동 등급을 덮지 않도록).
//
// 예외가 정말 필요하면 같은 줄에 `// gpu-display-ok` 주석을 달면 통과한다(의식적 허용 표식).

const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url)) // apps/web/
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)) // repo root (apps/web/lib/gpu → up4)

test('공급사 화면 견적 단가는 원본통화 SSOT를 쓴다 (fmtUSD 하드코딩 금지)', () => {
  const file = APP_ROOT + 'app/(member)/pricing/gpu/tabs/SuppliersTab.tsx'
  const src = readFileSync(file, 'utf8')
  // 견적 단가 표시(q.unit_price_usd)를 fmtUSD로 직접 감싸면 위반. 원본통화 SSOT를 쓰라.
  const bad = /fmtUSD\(\s*q\.unit_price_usd\s*\)/.test(src)
  assert.equal(bad, false, 'SuppliersTab 견적 단가는 fmtMoneyFromOriginal 등 원본통화 SSOT로 표시해야 함(넣은 통화 그대로)')
  assert.ok(src.includes('fmtMoneyFromOriginal'), 'SuppliersTab이 원본통화 SSOT(fmtMoneyFromOriginal)를 import·사용해야 함')
})

test('등급 잠금(tier_locked) 마이그레이션이 존재한다', () => {
  const mig = REPO_ROOT + 'supabase/migrations/158_gpu_tier_locked.sql'
  assert.ok(existsSync(mig), '158_gpu_tier_locked.sql (사람이 정한 등급 잠금) 마이그레이션이 있어야 함')
  const sql = readFileSync(mig, 'utf8')
  assert.ok(/tier_locked/.test(sql), '마이그레이션이 tier_locked 컬럼을 추가해야 함')
})

test('AI 조회 프롬프트 시드(gpu.db-chat) 마이그레이션이 존재한다', () => {
  const mig = REPO_ROOT + 'supabase/migrations/159_gpu_db_chat_prompt_seed.sql'
  assert.ok(existsSync(mig), '159_gpu_db_chat_prompt_seed.sql (AI 조회 프롬프트 시드)가 있어야 함')
  const sql = readFileSync(mig, 'utf8')
  assert.ok(/gpu\.db-chat/.test(sql), "시드가 prompt_key 'gpu.db-chat'을 넣어야 함")
})
