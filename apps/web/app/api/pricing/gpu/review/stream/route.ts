import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import {
  getGeminiConfig, getExtractPrompt, getClassifyPrompt, extractUrls, fetchUrlText,
  loadSpecContext, callGeminiStream, loadSchemaDigest, synthesizeExtractPrompt,
} from '@/lib/gpu/extract-helpers'

// 통합입력 실시간 스트리밍 분석 — SSE.
// 추출 결과는 "미리보기"만 반환(저장 X). 사용자가 버튼을 눌러야 저장(경쟁사: market/import, 공급가: review POST).
// 기존 review/route.ts(POST)는 무수정 보존 — 회귀 0.

const CLASSIFY_FALLBACK = `당신은 GPU 클라우드 가격 분석 AI입니다. 입력을 competitor(경쟁 클라우드 가격) 또는 supplier(공급사 견적)로 분류하세요. competitor면 {"type":"competitor","items":[{"competitor_name","model_name","memory","price_usd","pricing_model","notes"}]}, 아니면 {"type":"supplier"}. JSON만 반환.`

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  void supabase

  let body: { text?: unknown; channel?: unknown; imageData?: unknown }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const rawInputText = typeof body.text === 'string' ? body.text.trim() : ''
  const imgInput = (body.imageData && typeof body.imageData === 'object') ? body.imageData as { data?: unknown; mimeType?: unknown } : null
  const imageBase64 = typeof imgInput?.data === 'string' ? imgInput.data : null
  const imageMimeType = typeof imgInput?.mimeType === 'string' ? imgInput.mimeType : 'image/jpeg'
  if (!rawInputText && !imageBase64) return new Response('분석할 텍스트 또는 이미지가 없습니다', { status: 400 })

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
        const sourceUrl = urls[0] ?? null
        if (urls.length > 0) {
          send('progress', { step: 'url', msg: `URL ${urls.length}개 감지 — 페이지 내용을 가져오는 중…` })
          const bodies = await Promise.all(urls.map((u) => fetchUrlText(u)))
          const merged = bodies.map((b, i) => (b ? `\n\n[URL 본문 ${i + 1}: ${urls[i]}]\n${b}` : '')).join('')
          if (merged) contentText = `${rawInputText}${merged}`
          send('progress', { step: 'url_done', msg: merged ? 'URL 본문을 수집했습니다.' : 'URL에서 가격 정보를 찾지 못해 입력 텍스트로 진행합니다.' })
        }

        // 2) DB 스키마 자가인지 + 보유 스펙 카탈로그 로드
        send('progress', { step: 'schema', msg: 'DB 스키마와 보유 GPU 스펙을 인지하는 중…' })
        const [schemaDigest, specContext] = await Promise.all([
          loadSchemaDigest(adminClient),
          loadSpecContext(adminClient),
        ])

        // 3) 분류 (경쟁사 vs 공급가) — 스트리밍 (이미지는 분류 건너뛰고 바로 추출)
        let classified: { type?: string; items?: unknown[]; supplier_present?: boolean } = {}
        if (!imageBase64) {
          send('progress', { step: 'classify', msg: '경쟁사 가격인지 공급사 견적인지 판별하는 중…' })
          const classifyPrompt = await getClassifyPrompt(adminClient, CLASSIFY_FALLBACK)
          const classifyText = await callGeminiStream(
            config.apiKey, config.model,
            [{ text: `${classifyPrompt}\n\n${schemaDigest}${specContext}\n\n입력:\n${contentText}` }],
            (delta) => send('token', { phase: 'classify', delta }),
          )
          try { classified = JSON.parse(classifyText) } catch { /* fallthrough */ }
        } else {
          send('progress', { step: 'ocr', msg: '이미지에서 견적 정보를 읽는 중…' })
        }

        // R3: 혼합 입력 — 경쟁사 가격을 먼저 내보내고, supplier_present면 공급가 추출까지 이어감(데이터 손실 방지)
        let competitorEmitted = false
        if (classified.type === 'competitor' && Array.isArray(classified.items) && classified.items.length > 0) {
          send('progress', { step: 'classified', msg: `경쟁사 가격 ${classified.items.length}건 추출` })
          send('preview', { type: 'competitor', items: classified.items, source_url: sourceUrl })
          competitorEmitted = true
          if (!classified.supplier_present) {
            send('done', { type: 'competitor', count: classified.items.length })
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
        if (imageBase64) extractParts.push({ inlineData: { data: imageBase64, mimeType: imageMimeType } })
        extractParts.push({ text: promptText })
        const extractText = await callGeminiStream(
          config.apiKey, config.model,
          extractParts,
          (delta) => send('token', { phase: 'extract', delta }),
        )
        let parsed: { items?: Array<{ extracted?: Record<string, unknown> }>; extracted?: Record<string, unknown> } = {}
        try { parsed = JSON.parse(extractText) } catch { send('error', { msg: 'AI 응답 파싱 실패' }); controller.close(); return }

        const meaningful = (arr: Array<{ extracted?: Record<string, unknown> }>) => arr.filter((it) => {
          const n = it?.extracted?.model_name
          return typeof n === 'string' && n.trim().length > 0
        }).slice(0, 50)
        let items = meaningful(Array.isArray(parsed.items) ? parsed.items : (parsed.extracted ? [{ extracted: parsed.extracted }] : []))

        // R2: 미준비 입력 → 프롬프트 자가합성 후 1회 재시도 (URL 없을 때만 — URL빈손은 안내가 맞음)
        if (items.length === 0 && urls.length === 0 && contentText.trim().length > 10) {
          send('progress', { step: 'synthesize', msg: '준비된 규칙으로 못 뽑았습니다 — 이 형식에 맞는 추출 프롬프트를 새로 만드는 중…' })
          const synth = await synthesizeExtractPrompt(adminClient, config.apiKey, config.model, contentText, schemaDigest)
          if (synth) {
            send('progress', { step: 'synthesized', msg: `맞춤 추출 규칙 생성(draft: ${synth.promptKey}) — 재추출 중…` })
            const retryText = await callGeminiStream(
              config.apiKey, config.model,
              [{ text: `${synth.content}\n\n${schemaDigest}${specContext}\n\n입력 텍스트:\n${contentText}` }],
              (delta) => send('token', { phase: 'retry', delta }),
            )
            let retryParsed: { items?: Array<{ extracted?: Record<string, unknown> }>; extracted?: Record<string, unknown> } = {}
            try { retryParsed = JSON.parse(retryText) } catch { /* ignore */ }
            items = meaningful(Array.isArray(retryParsed.items) ? retryParsed.items : (retryParsed.extracted ? [{ extracted: retryParsed.extracted }] : []))
            if (items.length > 0) {
              send('progress', { step: 'synth_ok', msg: `자가합성 규칙으로 ${items.length}건 추출 성공 (검수 대기 draft로 저장됨)` })
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

        send('progress', { step: 'extracted', msg: `공급사 견적 ${items.length}건 추출 완료 — 미리보기 생성` })
        send('preview', { type: 'supplier', items })
        send('done', { type: competitorEmitted ? 'mixed' : 'supplier', count: items.length })
        controller.close()
      } catch (e) {
        send('error', { msg: e instanceof Error ? e.message : 'AI 분석 실패' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
