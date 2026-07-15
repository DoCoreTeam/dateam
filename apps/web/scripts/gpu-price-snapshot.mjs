#!/usr/bin/env node
// gpu-price-snapshot.mjs — GPU 가격/등급 회귀 안전망(설계 헌법 Phase 0)
//
// 재설계로 tier·통화·정렬 등을 손대기 전/후에 "기존 가격이 조용히 바뀌지 않았는지"를 비교하기 위한
// 스냅샷을 남긴다. 위험 작업(자동확정 등) 착수 전 `snapshot`, 완료 후 `compare`로 회귀를 검출.
//
// 사용법:
//   node scripts/gpu-price-snapshot.mjs snapshot   # 현재 상태를 .ralph/snapshots/gpu-YYYYMMDD.json 로 저장
//   node scripts/gpu-price-snapshot.mjs compare <before.json>   # 저장본과 현재를 비교, 차이 출력
//
// 접속: .env.local 의 SUPABASE_CONNET_KEY (postgres 연결 문자열). 읽기 전용 쿼리만 수행.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { Client } from 'pg'

function connString() {
  const env = readFileSync(new URL('../../../.env.local', import.meta.url), 'utf8')
  const m = env.match(/^SUPABASE_CONNET_KEY=(.+)$/m)
  if (!m) throw new Error('.env.local 에 SUPABASE_CONNET_KEY 가 없습니다')
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function fetchRows() {
  const client = new Client({ connectionString: connString() })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT id, model_name, memory, gpu_count, tier, tier_locked, strategic_price_krw
         FROM gpu_products WHERE deleted_at IS NULL ORDER BY id`,
    )
    return rows
  } finally {
    await client.end()
  }
}

function key(r) { return `${r.model_name}|${r.memory}|${r.gpu_count}` }

async function main() {
  const cmd = process.argv[2]
  if (cmd === 'snapshot') {
    const rows = await fetchRows()
    const dir = new URL('../../../.ralph/snapshots/', import.meta.url)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 파일명에 날짜를 넣되, Date.now 대신 인자 우선(재현성). 없으면 'latest'.
    const tag = process.argv[3] || 'latest'
    const out = new URL(`../../../.ralph/snapshots/gpu-${tag}.json`, import.meta.url)
    writeFileSync(out, JSON.stringify(rows, null, 2))
    console.log(`✅ 스냅샷 ${rows.length}행 저장: .ralph/snapshots/gpu-${tag}.json`)
  } else if (cmd === 'compare') {
    const beforePath = process.argv[3]
    if (!beforePath) throw new Error('비교할 before.json 경로를 주세요')
    const before = JSON.parse(readFileSync(beforePath, 'utf8'))
    const after = await fetchRows()
    const bMap = new Map(before.map((r) => [key(r), r]))
    const diffs = []
    for (const a of after) {
      const b = bMap.get(key(a))
      if (!b) continue
      if (a.tier !== b.tier) diffs.push(`${key(a)}: 등급 ${b.tier}→${a.tier}`)
      if (String(a.strategic_price_krw) !== String(b.strategic_price_krw)) diffs.push(`${key(a)}: 판매가 ${b.strategic_price_krw}→${a.strategic_price_krw}`)
    }
    if (diffs.length === 0) console.log('✅ 회귀 없음 — 기존 등급·판매가 동일')
    else { console.log(`⚠️ ${diffs.length}건 변동:`); diffs.forEach((d) => console.log('  ' + d)) }
  } else {
    console.log('사용법: node scripts/gpu-price-snapshot.mjs snapshot [tag] | compare <before.json>')
    process.exit(1)
  }
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
