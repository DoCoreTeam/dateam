import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dir, '../supabase/migrations/006_kpi_template_label.sql'), 'utf8')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE env vars — run from project root with .env.local loaded')
  process.exit(1)
}

const client = createClient(url, key, { auth: { persistSession: false } })

// Execute via pg extension
const { error } = await client.rpc('exec_sql', { query: sql }).single().catch(() => ({ error: 'rpc not available' }))

if (error) {
  // Fallback: use REST API execute endpoint
  const res = await fetch(`${url}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    console.log('⚠️  자동 적용 불가 — Supabase 대시보드 SQL 에디터에 아래 SQL을 붙여넣으세요:')
    console.log('\n' + sql)
    process.exit(0)
  }
}

console.log('✅ 마이그레이션 006 적용 완료')
