import { htmlToStructuredText } from '../lib/gpu/html-table-extract.ts'
import { buildTranscriptionPrompt, parseTranscription } from '../lib/gpu/transcription.ts'
import { transcriptionToCompetitorItems } from '../lib/gpu/transcription-to-items.ts'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k:string)=>(env.match(new RegExp(`^${k}=(.*)$`,'m'))||[])[1]?.trim().replace(/^["']|["']$/g,'')
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL')!, get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}})
const { data } = await admin.from('org_content').select('value').eq('key','META').single()
const meta=(data?.value??{}) as any; const apiKey=meta.gemini_api_key||get('GEMINI_API_KEY'); const model=meta.gemini_model||'gemini-2.0-flash'

// 1) 렌더(puppeteer 직접, 일반 UA) — headless-fetch와 동일 설정
const pmod:any = await import('puppeteer-core'); const puppeteer=pmod.default??pmod
let browser:any=null, text=''
try {
  browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'], executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true })
  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
  await page.goto('https://nebius.com/prices', { waitUntil:'networkidle2', timeout:30000 }).catch(()=>{})
  await new Promise(r=>setTimeout(r,2000))
  text = htmlToStructuredText(await page.content())
} finally { try{await browser?.close()}catch{} }
console.log('[URL] 표텍스트 길이:', text.length)

// 2) 전사(텍스트 입력) + 실 Gemini
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
  body: JSON.stringify({ contents:[{parts:[{text: buildTranscriptionPrompt()+'\n\n입력:\n'+text.slice(0,30000)}]}], generationConfig:{temperature:0,responseMimeType:'application/json'} })
})
const j:any = await res.json()
const parsed = parseTranscription(j?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).join('')??'')
const items = transcriptionToCompetitorItems(parsed.rows, { provider:'Nebius' })
console.log('[URL] 전사 행수:', parsed.rows.length, '| 경쟁사 아이템:', items.length)
for (const it of items as any[]) console.log('   -', it.model_name, '|', it.price_usd ?? '(미상)', it.price_unknown?'가격미상':'')
const names = (items as any[]).map(i=>String(i.model_name))
const EXPECT=['GB300','B300','GB200','B200','H200','H100','PRO 6000','L40S']
const missing = EXPECT.filter(m=>!names.some(n=>n.toUpperCase().includes(m.toUpperCase())))
const h100=names.filter(n=>/H100/i.test(n)).length
console.log('[URL] 판정: 8모델', EXPECT.length-missing.length,'/8', missing.length?'누락:'+missing.join(','):'✅', '| H100표기',h100,'(둔갑',h100<=2?'0✅':'의심❌',')')
process.exit(missing.length===0 && h100<=2 ? 0 : 2)
