// [실경로 검증] 캡처 Nebius 표 → 실 buildTranscriptionPrompt + 실 Gemini → parseTranscription
//   → **화면에 그려지는 바로 그 변환** transcriptionToCompetitorItems 까지 돌려 원문 모델명·가격미상 보존 단언.
//   (지난 실수 교정: 단독 전사가 아니라 실제 경쟁사 아이템 생성 경로를 검증)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { buildTranscriptionPrompt, parseTranscription } from '../lib/gpu/transcription.ts'
import { transcriptionToCompetitorItems } from '../lib/gpu/transcription-to-items.ts'
import { reconcile } from '../lib/gpu/reconcile.ts'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL')!, get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
const meta = (data?.value ?? {}) as Record<string, unknown>
const apiKey = (meta.gemini_api_key as string) || get('GEMINI_API_KEY') || ''
const model = (meta.gemini_model as string) || 'gemini-2.0-flash'
if (!apiKey) { console.error('Gemini 키 없음'); process.exit(1) }
console.log('[TEST] model =', model)

const b64 = readFileSync('/tmp/nebius-gpu.png').toString('base64')
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({
    contents: [{ parts: [{ inlineData: { data: b64, mimeType: 'image/png' } }, { text: buildTranscriptionPrompt() }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  }),
})
const j = await res.json() as any
const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
const parsed = parseTranscription(text)

// ▼ 화면에 가는 바로 그 변환
const items = transcriptionToCompetitorItems(parsed.rows, { provider: 'Nebius' })

console.log('[TEST] 전사 행수 =', parsed.rows.length, '| 경쟁사 아이템 =', items.length)
console.log('[TEST] 화면에 표시될 아이템(model_name | price | 가격미상):')
for (const it of items as any[]) console.log('   -', it.model_name, '|', it.price_usd ?? '(미상)', '|', it.price_unknown ? '가격미상' : '')

// 단언 1: 원문 보존 — H100 둔갑 0 (B300/B200이 H100으로 바뀌지 않음)
const names = (items as any[]).map((i) => String(i.model_name))
const hasB300 = names.some((n) => /B300/i.test(n))
const hasB200 = names.some((n) => /B200/i.test(n))
const h100Count = names.filter((n) => /H100/i.test(n)).length  // 정상이면 H100 1건만(HGX H100)
const gb300 = (items as any[]).find((i) => /GB300/i.test(i.model_name))
const gb200 = (items as any[]).find((i) => /GB200/i.test(i.model_name))
const EXPECT = ['GB300','B300','GB200','B200','H200','H100','PRO 6000','L40S']
const missing = EXPECT.filter((m) => !names.some((n) => n.toUpperCase().includes(m.toUpperCase())))

console.log('\n[TEST] ━━━ 판정 ━━━')
console.log('  8모델 전부 원문 표기:', EXPECT.length - missing.length, '/', EXPECT.length, missing.length ? '누락: ' + missing.join(',') : '✅')
console.log('  B300 원문 보존:', hasB300 ? '✅' : '❌ (H100으로 둔갑?)')
console.log('  B200 원문 보존:', hasB200 ? '✅' : '❌')
console.log('  H100 표기 건수(정상=1):', h100Count, h100Count <= 2 ? '✅(둔갑 없음)' : '❌(둔갑 의심)')
console.log('  GB300 가격미상 보존:', gb300 ? (gb300.price_unknown ? '✅' : '⚠️ 있으나 가격있음') : '❌ 누락')
console.log('  GB200 가격미상 보존:', gb200 ? (gb200.price_unknown ? '✅' : '⚠️') : '❌ 누락')
const recon = reconcile(parsed.source_row_count, items as any[], parsed.rows.map((r) => r.raw_label))
console.log('  reconcile:', JSON.stringify(recon))

const ok = missing.length === 0 && hasB300 && hasB200 && h100Count <= 2 && gb300?.price_unknown && gb200?.price_unknown
console.log(ok ? '\n  RESULT: PASS ✅ — 원문 보존·둔갑0·가격미상 보존' : '\n  RESULT: FAIL ❌')
process.exit(ok ? 0 : 2)
