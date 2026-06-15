// 일회성 백필: daily_logs/accounts/deals/contacts 의 embedding(null) 채우기.
// embedText(CLUSTERING, gemini-embedding-001, 768d)와 동일 설정 — 기존 daily_logs 임베딩과 같은 벡터공간.
// 실행: node scripts/backfill-autolink-embeddings.mjs   (apps/web/.env.local + org_content META 키 사용)
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const envPath = '.env.local'
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Gemini 키 (org_content META)
const { data: meta } = await supa.from('org_content').select('value').eq('key', 'META').single()
const GKEY = meta?.value?.gemini_api_key
if (!GKEY) { console.error('no gemini key'); process.exit(1) }

const EMBED_MODEL = 'gemini-embedding-001'
const DIM = 768
async function embed(text) {
  const t = (text ?? '').trim()
  if (!t) return null
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GKEY },
    body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t.slice(0, 2000) }] }, taskType: 'CLUSTERING', outputDimensionality: DIM }),
  })
  if (!res.ok) { console.error('embed err', res.status); return null }
  const j = await res.json()
  const v = j.embedding?.values
  return v && v.length === DIM ? `[${v.join(',')}]` : null
}

async function backfill(table, textOf) {
  const { data, error } = await supa.from(table).select('*').is('embedding', null)
  if (error) { console.error(table, error.message); return }
  let ok = 0
  for (const row of data ?? []) {
    const text = textOf(row)
    if (!text) continue
    const lit = await embed(text)
    if (!lit) continue
    const { error: ue } = await supa.from(table).update({ embedding: lit }).eq('id', row.id)
    if (!ue) ok++
  }
  console.log(`${table}: ${ok}/${(data ?? []).length} embedded`)
}

await backfill('daily_logs', (r) => r.content || r.original_input || '')
await backfill('accounts', (r) => [r.name, r.industry, r.memo, r.notes].filter(Boolean).join(' '))
await backfill('deals', (r) => [r.title, r.stage, r.memo, r.notes].filter(Boolean).join(' '))
await backfill('contacts', (r) => [r.name, r.title, r.company, r.memo].filter(Boolean).join(' '))
console.log('backfill done')
