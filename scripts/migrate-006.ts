import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

const client = createClient(url, key, { auth: { persistSession: false } })

// Check if column already exists via a test query
const { data: check, error: checkErr } = await client
  .from('kpi_entries')
  .select('kpi_template_label')
  .limit(0)

if (!checkErr) {
  console.log('✅ kpi_template_label 컬럼이 이미 존재합니다')
  process.exit(0)
}

console.log('컬럼 없음 — 아래 SQL을 Supabase 대시보드 SQL 에디터에서 실행하세요:')
console.log(`
-- 006_kpi_template_label.sql
ALTER TABLE kpi_entries ADD COLUMN IF NOT EXISTS kpi_template_label TEXT;
CREATE INDEX IF NOT EXISTS idx_kpi_entries_template_label
  ON kpi_entries (kpi_template_label)
  WHERE kpi_template_label IS NOT NULL;
`)
