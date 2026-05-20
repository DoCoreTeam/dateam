import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dir, '../supabase/migrations/002_weekly_reports_team_select.sql'), 'utf8')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing SUPABASE env vars')
  process.exit(1)
}

const client = createClient(url, key, { auth: { persistSession: false } })

const { error } = await client.rpc('exec_sql', { query: sql }).single().catch(() => ({ error: 'rpc not available' }))

if (error) {
  console.log('⚠️  자동 적용 불가 — Supabase 대시보드 SQL 에디터에 아래 SQL을 붙여넣으세요:')
  console.log('\n' + sql)
  process.exit(0)
}

console.log('✅ 마이그레이션 002 적용 완료')
