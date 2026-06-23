// [실 파이프라인 검증] 캡처한 Nebius 표 이미지 → 실제 buildTranscriptionPrompt + 실 Gemini Vision → parseTranscription.
// "전사 우선"이 9개 모델을 누락 없이 옮기는지 직접 검증(어느 코드가 도는지 확실 — 실제 lib import).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { buildTranscriptionPrompt, parseTranscription } from '../lib/gpu/transcription.ts'
import { reconcile } from '../lib/gpu/reconcile.ts'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL')!, get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// 1) Gemini 키/모델 (앱과 동일: org_content META)
const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
const meta = (data?.value ?? {}) as Record<string, unknown>
const apiKey = (meta.gemini_api_key as string) || get('GEMINI_API_KEY') || ''
const model = (meta.gemini_model as string) || 'gemini-2.0-flash'
if (!apiKey) { console.error('Gemini 키 없음'); process.exit(1) }
console.log('[TEST] model =', model)

// 2) 캡처 이미지
const b64 = readFileSync('/tmp/nebius-gpu.png').toString('base64')

// 3) 실제 전사 프롬프트 + 실 Gemini Vision
const prompt = buildTranscriptionPrompt()
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify({
    contents: [{ parts: [{ inlineData: { data: b64, mimeType: 'image/png' } }, { text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  }),
})
const j = await res.json() as any
const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''

// 4) 실제 파서
const parsed = parseTranscription(text)
console.log('[TEST] source_row_count =', parsed.source_row_count, '| rows =', parsed.rows.length)
console.log('[TEST] 전사된 라벨:')
for (const r of parsed.rows) console.log('   -', JSON.stringify(r.raw_label), '| price:', r.price_text ?? '(없음=가격미상)')

// 5) 누락 단언 — 실제 표의 9개 모델
const EXPECT = ['GB300', 'B300', 'GB200', 'B200', 'H200', 'H100', 'PRO 6000', 'L40S']
const labels = parsed.rows.map((r) => (r.raw_label || '').toUpperCase())
const missing = EXPECT.filter((m) => !labels.some((l) => l.includes(m.toUpperCase())))
const priceless = parsed.rows.filter((r) => !r.price_text)
console.log('\n[TEST] ━━━ 판정 ━━━')
console.log('  기대 모델 8종 중 전사됨:', EXPECT.length - missing.length, '/', EXPECT.length)
console.log('  누락 모델:', missing.length ? missing.join(', ') : '없음 ✅')
console.log('  가격미상(Contact us 등) 보존된 행:', priceless.length, '→', priceless.map((r) => r.raw_label).join(', ') || '없음')

// reconcile 데모(가령 추출이 일부만 됐다면)
const recon = reconcile(parsed.source_row_count, parsed.rows.map((r) => ({ source_model_name: r.raw_label })), parsed.rows.map((r) => r.raw_label))
console.log('  reconcile:', JSON.stringify(recon))

process.exit(missing.length === 0 ? 0 : 2)
