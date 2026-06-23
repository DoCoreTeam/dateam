import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import {
  getGeminiConfig, getExtractPrompt, getClassifyPrompt, extractUrls, fetchUrlText,
  loadSpecContext, callGeminiStream, loadSchemaDigest, synthesizeExtractPrompt,
} from '@/lib/gpu/extract-helpers'
import { dedupSupplier, dedupCompetitor, type CompetitorLike } from '@/lib/gpu/dedup'
import { INTAKE_LIMITS } from '@/lib/gpu/intake-files'
import { resolveClassification } from '@/lib/gpu/provider-registry'

// 통합입력 실시간 스트리밍 분석 — SSE.
// 추출 결과는 "미리보기"만 반환(저장 X). 사용자가 버튼을 눌러야 저장(경쟁사: market/import, 공급가: review POST).
// 기존 review/route.ts(POST)는 무수정 보존 — 회귀 0.

const CLASSIFY_FALLBACK = `당신은 GPU 클라우드 가격 분석 AI입니다. 입력을 competitor(경쟁 클라우드 가격) 또는 supplier(공급사 견적)로 분류하세요. competitor면 {"type":"competitor","items":[{"competitor_name","model_name","memory","price_usd","pricing_model","notes"}]}, 아니면 {"type":"supplier"}. JSON만 반환.`

// 입력 텍스트 길이 상한 — 거대 텍스트로 인한 메모리/정규식 부하 방어(ReDoS·DoS).
const MAX_INPUT_TEXT = 200_000

// 추출 결과 건수 상한 — 데이터 손실용(구 50건)이 아니라 페이로드 폭주 방어용. 정상 가격표를 잘리지 않게 대폭 상향.
const EXTRACT_MAX_ITEMS = 500

// 매직바이트 검증 — file.type(브라우저 주장값) 스푸핑 방어. 실제 시그니처가 비전 형식일 때만 Gemini로 전송.
function sniffVisionMime(bytes: Uint8Array, declaredMime: string): string | null {
  const b = bytes
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  void declaredMime
  return null // 시그니처 불일치 → 비전 콘텐츠 아님(스푸핑 의심) → 전송 안 함
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  void supabase

  // 전송 형식 분기: multipart/form-data(신규 — base64 인플레 없음) 우선, 아니면 JSON(base64, 하위호환).
  // 이미지/PDF를 raw 바이너리로 받아 서버에서 base64 변환 → 클라이언트 JSON 본문 +33% 인플레로 인한 4.5MB 초과 실패 해소.
  const contentType = req.headers.get('content-type') ?? ''
  let rawInputText = ''
  let imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = []

  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try { form = await req.formData() } catch { return new Response('bad request', { status: 400 }) }
    rawInputText = (typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '').slice(0, MAX_INPUT_TEXT)
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    const parts: Array<{ inlineData: { data: string; mimeType: string } }> = []
    for (const file of files.slice(0, 10)) {
      // 서버측 크기 가드 — 메모리 폭주 방어(클라이언트 상수에 의존하지 않고 서버에서 강제).
      if (file.size > INTAKE_LIMITS.MAX_STREAM_FILE) {
        return new Response(`파일이 너무 큽니다(최대 ${INTAKE_LIMITS.MAX_STREAM_FILE / 1024 / 1024}MB): ${file.name}`, { status: 413 })
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      // 매직바이트 검증 — file.type 스푸핑 방어. 실제 이미지/PDF 시그니처일 때만 전송.
      const verifiedMime = sniffVisionMime(buf, file.type)
      if (!verifiedMime) continue
      const data = Buffer.from(buf).toString('base64')
      if (data.length > 0) parts.push({ inlineData: { data, mimeType: verifiedMime } })
    }
    imageParts = parts
  } else {
    let body: { text?: unknown; images?: unknown; imageData?: unknown }
    try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
    rawInputText = (typeof body.text === 'string' ? body.text.trim() : '').slice(0, MAX_INPUT_TEXT)
    // 다중 이미지(images[]) 우선, 없으면 단일 imageData(하위호환)
    const rawImages: Array<{ data?: unknown; mimeType?: unknown }> = Array.isArray(body.images)
      ? body.images as Array<{ data?: unknown; mimeType?: unknown }>
      : (body.imageData && typeof body.imageData === 'object' ? [body.imageData as { data?: unknown; mimeType?: unknown }] : [])
    imageParts = rawImages
      .filter((im) => typeof im?.data === 'string' && (im.data as string).length > 0)
      .slice(0, 10)
      .map((im) => ({ inlineData: { data: im.data as string, mimeType: typeof im.mimeType === 'string' ? im.mimeType : 'image/jpeg' } }))
  }
  const hasImages = imageParts.length > 0
  if (!rawInputText && !hasImages) return new Response('분석할 텍스트 또는 이미지가 없습니다', { status: 400 })

  const adminClient = createAdminClient()
  const config = await getGeminiConfig(adminClient)
  if (!config.apiKey) return new Response('AI 키 미설정', { status: 500 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      try {
        send('progress', { step: 'start', msg: '입력을 분석하고 있습니다…' })

        // 1) URL 감지·fetch (멀티 + 병합)
        const urls = extractUrls(rawInputText)
        let contentText = rawInputText
        let urlTruncated = false
        const sourceUrl = urls[0] ?? null
        if (urls.length > 0) {
          send('progress', { step: 'url', msg: `URL ${urls.length}개 감지 — 페이지 내용을 가져오는 중…` })
          const bodies = await Promise.all(urls.map((u) => fetchUrlText(u)))
          urlTruncated = bodies.some((b) => b.truncated)
          const merged = bodies.map((b, i) => (b.text ? `\n\n[URL 본문 ${i + 1}: ${urls[i]}]\n${b.text}` : '')).join('')
          if (merged) contentText = `${rawInputText}${merged}`
          send('progress', { step: 'url_done', msg: merged ? 'URL 본문을 수집했습니다.' : 'URL에서 가격 정보를 찾지 못해 입력 텍스트로 진행합니다.' })
          if (urlTruncated) send('progress', { step: 'truncated', msg: 'URL 본문이 매우 길어 일부가 잘렸습니다. 누락이 의심되면 페이지 내용을 직접 붙여넣어 주세요.' })
        }

        // 2) DB 스키마 자가인지 + 보유 스펙 카탈로그 로드
        send('progress', { step: 'schema', msg: 'DB 스키마와 보유 GPU 스펙을 인지하는 중…' })
        const [schemaDigest, specContext] = await Promise.all([
          loadSchemaDigest(adminClient),
          loadSpecContext(adminClient),
        ])

        // 3) 분류 (경쟁사 vs 공급가) — 스트리밍.
        //    C3: 이미지/PDF도 분류 수행(스킵 제거). 텍스트와 동일하게 AI 분류 + provider 화이트리스트/사용자 의도 override 적용.
        let classified: { type?: string; items?: unknown[]; supplier_present?: boolean } = {}
        send('progress', { step: 'classify', msg: '경쟁사 가격인지 공급사 견적인지 판별하는 중…' })
        const classifyPrompt = await getClassifyPrompt(adminClient, CLASSIFY_FALLBACK)
        const classifyParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
        if (hasImages) classifyParts.push(...imageParts)
        classifyParts.push({ text: `${classifyPrompt}\n\n${schemaDigest}${specContext}\n\n${contentText ? '입력:\n' + contentText : '위 이미지에서 분류하세요.'}` })
        const classifyText = await callGeminiStream(
          config.apiKey, config.model, classifyParts,
          (delta) => send('token', { phase: 'classify', delta }),
        )
        try { classified = JSON.parse(classifyText) } catch { /* fallthrough */ }
        if (hasImages) send('progress', { step: 'ocr', msg: '이미지에서 견적 정보를 읽는 중…' })

        // C1/C4: provider 화이트리스트 + 사용자 의도(경쟁사/공급가)로 결정적 보정.
        //    AI가 supplier로 분류해도 입력에 경쟁 클라우드가 명확하거나 "경쟁사" 의도가 있으면 competitor로 승격.
        //    rawInputText 기준(이미지 동반 텍스트 포함) — 화이트리스트/의도는 텍스트 신호로만 판정(과교정 방지).
        const decision = resolveClassification({
          text: rawInputText,
          aiType: classified.type,
          aiSupplierPresent: classified.supplier_present,
        })
        if (decision.decision === 'competitor') {
          classified = { ...classified, type: 'competitor', supplier_present: decision.supplierPresent }
          if (decision.reason === 'whitelist' || decision.reason === 'intent') {
            send('progress', { step: 'classify_override', msg: `경쟁 클라우드로 판정(${decision.reason === 'intent' ? '사용자 지정' : '제공사 인식'}).` })
          }
        } else if (decision.reason === 'intent') {
          classified = { ...classified, type: 'supplier', supplier_present: false }
        }

        // C1/C3/C4: 화이트리스트/의도로 competitor 승격됐는데 AI가 경쟁사 items를 안 준 경우(예: AI는 supplier로 봤거나 이미지),
        //    경쟁사 스키마로 1회 재추출(이미지 포함)해 시장가로 라우팅(공급가 오적재 방지).
        if (
          classified.type === 'competitor' &&
          (!Array.isArray(classified.items) || classified.items.length === 0) &&
          (decision.reason === 'whitelist' || decision.reason === 'intent')
        ) {
          send('progress', { step: 'reclassify', msg: '경쟁 클라우드 가격으로 다시 추출하는 중…' })
          const recParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
          if (hasImages) recParts.push(...imageParts)
          recParts.push({ text: `${classifyPrompt}\n\n반드시 type을 competitor로 하고 items에 모델·가격을 추출하세요.\n\n${schemaDigest}${specContext}\n\n${contentText ? '입력:\n' + contentText : '위 이미지에서 추출하세요.'}` })
          const recText = await callGeminiStream(
            config.apiKey, config.model, recParts,
            (delta) => send('token', { phase: 'classify', delta }),
          )
          try {
            const rec = JSON.parse(recText) as { items?: unknown[] }
            if (Array.isArray(rec.items) && rec.items.length > 0) {
              classified = { ...classified, items: rec.items }
            }
          } catch { /* 재추출 실패 — 아래 supplier 폴백 흐름으로 */ }
        }

        // R3: 혼합 입력 — 경쟁사 가격을 먼저 내보내고, supplier_present면 공급가 추출까지 이어감(데이터 손실 방지)
        let competitorEmitted = false
        if (classified.type === 'competitor' && Array.isArray(classified.items) && classified.items.length > 0) {
          const compItems = dedupCompetitor(classified.items as CompetitorLike[])
          send('progress', { step: 'classified', msg: `경쟁사 가격 ${compItems.length}건 추출${compItems.length < classified.items.length ? ` (중복 ${classified.items.length - compItems.length}건 제거)` : ''}` })
          send('preview', { type: 'competitor', items: compItems, source_url: sourceUrl })
          competitorEmitted = true
          if (!classified.supplier_present) {
            send('done', { type: 'competitor', count: compItems.length })
            controller.close(); return
          }
          send('progress', { step: 'mixed', msg: '입력에 우리 공급 견적도 포함 — 공급가도 이어서 추출합니다.' })
        }

        // 4) 공급가 추출 — 스트리밍(실시간 토큰)
        send('progress', { step: 'extract', msg: '공급사 견적에서 모델·가격·약정을 추출하는 중…' })
        const prompt = await getExtractPrompt(adminClient)
        if (!prompt) { send('error', { msg: 'AI 추출 프롬프트 미설정' }); controller.close(); return }
        // 혼합 입력일 때: 경쟁사 클라우드 가격은 제외하고 우리가 공급받는 견적만 추출(중복 혼입 방지)
        const exclusionNote = competitorEmitted
          ? '\n\n【중요】 이 입력에는 경쟁사 클라우드 가격(RunPod·Lambda·AWS 등 시세 참고)이 섞여 있습니다. 그것들은 제외하고, "우리가 공급받는 공급사 견적"만 items로 추출하세요. 경쟁사 시세는 절대 items에 포함하지 마세요.'
          : ''
        const promptText = `${prompt.content}${exclusionNote}\n\n${schemaDigest}${specContext}\n\n${contentText ? '입력 텍스트:\n' + contentText : '위 이미지에서 GPU 견적 정보를 추출하세요.'}`
        const extractParts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
        if (hasImages) extractParts.push(...imageParts)
        extractParts.push({ text: promptText })
        const extractText = await callGeminiStream(
          config.apiKey, config.model,
          extractParts,
          (delta) => send('token', { phase: 'extract', delta }),
        )
        let parsed: { items?: Array<{ extracted?: Record<string, unknown> }>; extracted?: Record<string, unknown> } = {}
        try { parsed = JSON.parse(extractText) } catch { send('error', { msg: 'AI 응답 파싱 실패' }); controller.close(); return }

        let itemsCapped = false
        const meaningful = (arr: Array<{ extracted?: Record<string, unknown> }>) => {
          const deduped = dedupSupplier(arr.filter((it) => {
            const n = it?.extracted?.model_name
            return typeof n === 'string' && n.trim().length > 0
          }))
          if (deduped.length > EXTRACT_MAX_ITEMS) itemsCapped = true
          return deduped.slice(0, EXTRACT_MAX_ITEMS)
        }
        let items = meaningful(Array.isArray(parsed.items) ? parsed.items : (parsed.extracted ? [{ extracted: parsed.extracted }] : []))

        // R2: 미준비 입력 → 프롬프트 자가합성 후 1회 재시도 (URL 없을 때만 — URL빈손은 안내가 맞음)
        if (items.length === 0 && urls.length === 0 && contentText.trim().length > 10) {
          send('progress', { step: 'synthesize', msg: '준비된 규칙으로 못 뽑았습니다 — 이 형식에 맞는 추출 프롬프트를 새로 만드는 중…' })
          const synth = await synthesizeExtractPrompt(adminClient, config.apiKey, config.model, contentText, schemaDigest)
          if (synth) {
            send('progress', { step: 'synthesized', msg: `맞춤 추출 규칙 생성(${synth.promptKey}${synth.activated ? ', 자동 반영' : ', eval 보류'}) — 재추출 중…` })
            const retryText = await callGeminiStream(
              config.apiKey, config.model,
              [{ text: `${synth.content}\n\n${schemaDigest}${specContext}\n\n입력 텍스트:\n${contentText}` }],
              (delta) => send('token', { phase: 'retry', delta }),
            )
            let retryParsed: { items?: Array<{ extracted?: Record<string, unknown> }>; extracted?: Record<string, unknown> } = {}
            try { retryParsed = JSON.parse(retryText) } catch { /* ignore */ }
            items = meaningful(Array.isArray(retryParsed.items) ? retryParsed.items : (retryParsed.extracted ? [{ extracted: retryParsed.extracted }] : []))
            // #5 라이브 모니터: 자가합성 프롬프트가 자기 재시도에서도 실패하면 즉시 자동 롤백/비활성(나쁜 AI 프롬프트가 active로 안 남게)
            if (synth.activated) {
              const { monitorAiPromptOutcome } = await import('@/lib/gpu/prompt-governance')
              const mon = await monitorAiPromptOutcome(adminClient as unknown as Record<string, unknown>, { promptKey: synth.promptKey, ok: items.length > 0, nowIso: new Date().toISOString() })
              if (mon.action !== 'none') send('progress', { step: 'auto_rollback', msg: `자가합성 프롬프트 품질 미달 — 자동 ${mon.action === 'rolled_back' ? `롤백(→${mon.toVersion})` : '비활성'}` })
            }
            if (items.length > 0) {
              send('progress', { step: 'synth_ok', msg: `자가합성 규칙으로 ${items.length}건 추출 성공` })
            }
          }
        }

        if (items.length === 0) {
          if (competitorEmitted) {
            // 혼합인데 공급가 추출이 비면 경쟁사만으로 정상 종료
            send('done', { type: 'competitor', count: 0 })
            controller.close(); return
          }
          send('error', { msg: urls.length > 0
            ? 'URL 본문에서 GPU 모델·가격을 찾지 못했습니다. 페이지 내용을 직접 붙여넣어 주세요.'
            : 'GPU 모델을 인식하지 못했습니다. 모델명·가격이 포함된 내용을 입력해 주세요.' })
          controller.close(); return
        }

        // P1-4: silent truncation 제거 — 결과 컷(500건) 또는 URL 본문 잘림 발생 시 사용자 고지.
        const truncated = itemsCapped || urlTruncated
        if (truncated) {
          send('progress', { step: 'truncated', msg: itemsCapped
            ? `추출 결과가 많아 상위 ${EXTRACT_MAX_ITEMS}건만 표시합니다(일부 잘림).`
            : 'URL 본문 일부가 잘려 누락이 있을 수 있습니다.' })
        }
        send('progress', { step: 'extracted', msg: `공급사 견적 ${items.length}건 추출 완료 — 미리보기 생성` })
        send('preview', { type: 'supplier', items })
        send('done', { type: competitorEmitted ? 'mixed' : 'supplier', count: items.length, truncated })
        controller.close()
      } catch (e) {
        // 상세는 서버 로그만, 클라이언트엔 일반화 메시지(내부 경로·키 노출 방지).
        console.error('[gpu/review/stream] error:', e)
        send('error', { msg: 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
