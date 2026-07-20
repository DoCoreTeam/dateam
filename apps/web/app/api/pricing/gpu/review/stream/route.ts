import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import {
  getGeminiConfig, getExtractPrompt, getClassifyPrompt, extractUrls, fetchUrlText,
  loadSpecContext, callGeminiStream, loadSchemaDigest, synthesizeExtractPrompt,
} from '@/lib/gpu/extract-helpers'
import { dedupSupplier, dedupCompetitor, type CompetitorLike } from '@/lib/gpu/dedup'
import { INTAKE_LIMITS } from '@/lib/gpu/intake-files'
import { resolveClassification, detectCompetitorProviders } from '@/lib/gpu/provider-registry'
import { buildTranscriptionPrompt, parseTranscription, type TranscriptionResult } from '@/lib/gpu/transcription'
import { reconcile, type ReconcileResult, type ReconcileExtractedLike } from '@/lib/gpu/reconcile'
import { transcriptionToCompetitorItems, proseToCompetitorItems } from '@/lib/gpu/transcription-to-items'
import { validateCompetitorItem, looksLikeGpuModel } from '@/lib/gpu/validate'
import { reconstructPivot } from '@/lib/gpu/pivot-reconstruct'
import { classifyObservation } from '@/lib/gpu/observation-classify'
import { amountToKrw, pricingModelForUnit, type FxKrwMap } from '@/lib/gpu/normalize-money'
import { canonicalizeModel } from '@/lib/gpu/canonical-model'
import { HOURS_PER_PERIOD } from '@/lib/gpu/hours'

// 헤드리스 렌더(@sparticuz/chromium)·전사·AI 호출에 시간 필요 → Node 런타임 + maxDuration 확대(Vercel 콜드스타트 여유).
export const runtime = 'nodejs'
export const maxDuration = 60

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

// 전사 호출 — 입력(이미지/텍스트)을 본 그대로 전사(매핑/스키마 미주입). source_row_count 확보.
// 비용 가드: 텍스트도 이미지도 없으면 스킵(빈 결과). 실패 시 빈 결과 폴백(대조는 source_rows=0으로 무해).
async function runTranscription(
  apiKey: string, model: string,
  imageParts: Array<{ inlineData: { data: string; mimeType: string } }>,
  contentText: string,
  onDelta: (delta: string) => void,
): Promise<TranscriptionResult> {
  const hasImages = imageParts.length > 0
  if (!hasImages && contentText.trim().length === 0) return { rows: [], source_row_count: 0 }
  const prompt = buildTranscriptionPrompt()
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = []
  if (hasImages) parts.push(...imageParts)
  parts.push({ text: `${prompt}\n\n${contentText ? '입력 텍스트:\n' + contentText : '위 이미지의 모든 가격표 행을 전사하세요.'}` })
  try {
    const text = await callGeminiStream(apiKey, model, parts, onDelta)
    return parseTranscription(text)
  } catch {
    return { rows: [], source_row_count: 0 }
  }
}

export async function POST(req: NextRequest) {
  // 통합입력 제출(추출/미리보기) — 내부 임직원(admin+member) 허용. DB 쓰기 없음(미리보기만).
  // 확정/시장반영(market/import·review 승인)은 admin 유지 — 제출↔확정 권한 분리.
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  void supabase

  // 전송 형식 분기: multipart/form-data(신규 — base64 인플레 없음) 우선, 아니면 JSON(base64, 하위호환).
  // 이미지/PDF를 raw 바이너리로 받아 서버에서 base64 변환 → 클라이언트 JSON 본문 +33% 인플레로 인한 4.5MB 초과 실패 해소.
  const contentType = req.headers.get('content-type') ?? ''
  let rawInputText = ''
  let declaredKind: 'competitor' | 'supplier' | null = null
  let imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = []

  if (contentType.includes('multipart/form-data')) {
    let form: FormData
    try { form = await req.formData() } catch { return new Response('bad request', { status: 400 }) }
    rawInputText = (typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '').slice(0, MAX_INPUT_TEXT)
    const dk = typeof form.get('declared_kind') === 'string' ? (form.get('declared_kind') as string) : ''
    declaredKind = dk === 'supplier' || dk === 'competitor' ? dk : null
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
    let body: { text?: unknown; images?: unknown; imageData?: unknown; declared_kind?: unknown }
    try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
    rawInputText = (typeof body.text === 'string' ? body.text.trim() : '').slice(0, MAX_INPUT_TEXT)
    declaredKind = body.declared_kind === 'supplier' || body.declared_kind === 'competitor' ? body.declared_kind : null
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

        // 2.5) 전사 우선 — 추출 전, 입력의 모든 가격표 행을 본 그대로 전사(매핑/스키마 미주입).
        //   source_row_count로 최종 추출건수와 대조(누락 가시화). 카탈로그 편향 제거가 핵심.
        send('progress', { step: 'transcribe', msg: '입력의 모든 가격표 행을 본 그대로 옮기는 중…' })
        const transcription = await runTranscription(
          config.apiKey, config.model, imageParts, contentText,
          (delta) => send('token', { phase: 'transcribe', delta }),
        )
        const sourceRowCount = transcription.source_row_count
        const sourceLabels = transcription.rows.map((r) => r.raw_label).filter((l) => l.length > 0)
        if (sourceRowCount > 0) send('progress', { step: 'transcribed', msg: `원본 가격표 ${sourceRowCount}행 확인 — 누락 없이 추출합니다.` })

        // 행수 대조 + done payload용 reconciliation 산출. missing>0이면 경고 progress 발신.
        // 전사를 못한 경우(source_rows=0)엔 대조 비활성(reconciliation=null) — 거짓 경고 방지.
        const buildReconciliation = (extractedItems: ReconcileExtractedLike[], byDistinctModel = false): ReconcileResult | null => {
          if (sourceRowCount <= 0) return null
          const r = reconcile(sourceRowCount, extractedItems, sourceLabels, { byDistinctModel })
          if (r.missing > 0) {
            const labelHint = r.missing_labels.length > 0 ? ` (${r.missing_labels.slice(0, 8).join(', ')})` : ''
            send('progress', { step: 'reconcile', msg: `원문 ${r.source_rows}행 중 ${r.extracted}행 추출 — ${r.missing}행 누락 의심${labelHint}` })
          }
          return r
        }

        // 3) 분류 (경쟁사 vs 공급가) — 스트리밍.
        //    C3: 이미지/PDF도 분류 수행(스킵 제거). 텍스트와 동일하게 AI 분류 + provider 화이트리스트/사용자 의도 override 적용.
        let classified: { type?: string; items?: unknown[]; supplier_present?: boolean } = {}
        // 사용자가 종류를 선언했으면 "판별 중"이 아니라 "선택한 종류로 분석 중"으로 표시(모순 방지). 헌법 제1조.
        send('progress', { step: 'classify', msg: declaredKind
          ? `${declaredKind === 'competitor' ? '경쟁사 시장가' : '공급사 견적'}로 분석하는 중…`
          : '경쟁사 가격인지 공급사 견적인지 판별하는 중…' })
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
          declared: declaredKind,
        })
        if (decision.reason === 'declared') {
          send('progress', { step: 'classify_declared', msg: `사용자가 선택한 종류로 확정: ${decision.decision === 'competitor' ? '경쟁사 시장가' : '공급사 견적'}` })
        }
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
        if (classified.type === 'competitor') {
          // 표시 아이템 출처 분리(근본수정): classify.items는 specContext(카탈로그 표준 매핑) 주입으로
          //   원문 모델명을 우리 카탈로그명으로 둔갑시킨다(HGX B300→H100, 가격없는 행 드롭, 2가격 2행).
          //   → 전사(verbatim) rows가 있으면 그것을 경쟁사 아이템 출처로 사용(원문·전 행·가격미상 보존).
          //   전사 실패(rows=0)일 때만 기존 classify.items 폴백(회귀 0).
          const useTranscription = transcription.rows.length > 0
          let compItems: Array<Record<string, unknown>> = []
          let rawCount = 0

          if (useTranscription) {
            // provider 추론 — 입력 텍스트의 화이트리스트 경쟁사명(Nebius 등). 첫 매칭 1개.
            const detected = detectCompetitorProviders(contentText)
            const provider = detected[0] ?? ''
            // 원본 통화 보존(W3) — KRW 입력의 USD 환산에 fx_rates 실환율 주입(하드코딩 금지). 폴백 1400.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: fxRow } = await (adminClient.from('fx_rates') as any).select('usd_krw').order('rate_date', { ascending: false }).limit(1).maybeSingle()
            const krwPerUsd = typeof fxRow?.usd_krw === 'number' && fxRow.usd_krw > 0 ? fxRow.usd_krw : 1400
            // 다통화 환율맵(엔·위안 등) — 피벗 복구 시 원본 통화가를 KRW/USD로 환산. 최신 고시일 1행.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: fxMultiRows } = await (adminClient.from('fx_rates_multi') as any)
              .select('currency, krw_per_1, rate_date').order('rate_date', { ascending: false }).limit(60)
            const fxMap: FxKrwMap = { KRW: 1, USD: krwPerUsd }
            let fxDate: string | null = null
            for (const r of (fxMultiRows ?? []) as Array<{ currency: string; krw_per_1: number; rate_date: string }>) {
              if (fxDate === null) fxDate = r.rate_date
              if (r.rate_date === fxDate && fxMap[r.currency] === undefined) fxMap[r.currency] = r.krw_per_1
            }
            const cands = transcriptionToCompetitorItems(transcription.rows, { provider, krwPerUsd, fxMap })
            // 동일 경쟁사·모델 중복만 제거(원문 보존 — 가격미상도 유지). 전사 1행=모델 1건이라 통상 no-op.
            const deduped = dedupCompetitor(cands as CompetitorLike[])
            rawCount = cands.length
            compItems = deduped.map((it) => {
              const v = validateCompetitorItem(it, { preserveNoPrice: true })
              return { ...it, price_unknown: v.priceUnknown === true }
            })
            // H100 복구(P5): 세로형 비교표(플랜=열)에서 전사는 속성라벨(月額·サービス)만 뽑고 진짜 모델(H100 등, 열헤더)을
            //   놓친다 → GPU 모델이 0건이 된다. 이때만 classify가 찾은 GPU 모델로 복구한다.
            //   단, classify 가격은 specContext 편향으로 환각 위험 → price_usd=null(보류)로만 살린다(가짜가격 유입 금지).
            //   전사가 GPU 모델을 하나라도 뽑은 정상 페이지엔 발동 안 함(회귀 0).
            // 산문 회수용 경쟁사명 — 전사 provider가 비면 classify가 식별한 회사명으로 보완(빈 이름 저장 방지).
            //   classify의 "가격"은 불신하지만 "회사명"은 라벨 식별이라 채택 가능(가짜 가격 유입과 무관).
            const proseProvider = provider || (Array.isArray(classified.items)
              ? String((classified.items as Array<Record<string, unknown>>).find((it) => typeof it.competitor_name === 'string' && it.competitor_name)?.competitor_name ?? '')
              : '')
            const gpuValid = compItems.filter((it) => looksLikeGpuModel(String((it as Record<string, unknown>).model_name ?? '')))
            if (gpuValid.length === 0) {
              // 1순위 — 피벗 재구성: 세로표에서 열별로 모델(サービス)+원본가(月額)+장수(×8)를 다시 묶는다.
              //   진짜 엔화 금액을 살려 fx로 환산(번들은 managed_bundle로 격리). 결정론(AI 산술 없음).
              const HOURS: Record<string, number> = HOURS_PER_PERIOD
              const pivot = reconstructPivot(transcription.rows as Array<{ raw_label?: string; cells?: unknown[]; price_text?: string | null }>)
              const fromPivot = pivot.map((o) => {
                const cls = classifyObservation(o.provenance + ' ' + o.model_name)
                const totalKrw = amountToKrw(o.amount, o.currency, fxMap) // 기간×장수 전체 KRW(환율 미보유면 null)
                const hours = o.pricing_unit ? HOURS[o.pricing_unit] : undefined
                const cnt = o.gpu_count && o.gpu_count > 0 ? o.gpu_count : 1
                const perGpuHrKrw = totalKrw != null && hours ? totalKrw / hours / cnt : null
                const priceUsd = perGpuHrKrw != null && krwPerUsd > 0 ? perGpuHrKrw / krwPerUsd : null
                // 모델명 정규화(SSOT) — "NVIDIA DGX H100プラン"→"H100"(카탈로그 매칭). 정규화 실패 시 원본 유지.
                const canon = canonicalizeModel(o.model_name)
                const modelName = canon.canonical || o.model_name
                // 요금형태: 월/년 = reserved(약정), 시간/분 = on_demand. 월정액도 버리지 않고 시간환산해 약정으로 저장(사용자 확정).
                const pricingModel = pricingModelForUnit(o.pricing_unit)
                return {
                  // 전사 provider가 비면 classify 식별 회사명으로 보완 — 경쟁사명 공란 저장 방지(URL 경로 실화면 사고).
                  competitor_name: proseProvider,
                  model_name: modelName,
                  source_model_name: o.model_name,
                  pricing_model: pricingModel,       // reserved(월정액) / on_demand(시간제) — 저장 시 like-for-like 비교축
                  price_usd: priceUsd,               // 원본 엔화 → 시간환산(÷720÷장수) → 환율 환산. 미보유 통화면 null
                  price_unknown: priceUsd == null,
                  original_currency: o.currency,
                  original_price: o.amount,
                  obs: {
                    amount: o.amount, currency: o.currency, pricing_unit: o.pricing_unit, gpu_count: o.gpu_count,
                    // segment는 obs 메타(포함내역·과세)만 보존 — 밴드 제외(managed_bundle)는 하지 않음.
                    //   사용자 확정: 월정액 번들도 reserved 시세로 비교 대상에 포함. 원본 포함내역은 참고용으로만 기록.
                    segment: null, bundle_inclusive: cls.bundle_inclusive, tax_basis: cls.tax_basis,
                    comparable: true, fx_source: 'koreaexim', fx_rate_date: fxDate,
                    fx_rate: o.currency && o.currency !== 'KRW' ? fxMap[o.currency] ?? null : 1,
                    provenance: o.provenance,
                  },
                }
              })
              // 산문형 복합요금 회수(T1.3 실경로) — 표가 아니라 산문이라 전사가 행을 못 쪼갠 요금(시간제 등).
              //   원문 전체에 결정론 파서를 1회 적용해 기본료·종량·스토리지를 성분으로 회수(AI 산술 없음).
              //   ★ 피벗과 배타가 아니라 **합집합**이다 — 소프트뱅크처럼 월정액 번들표와 시간제 산문이 한
              //   페이지에 공존하면 배타 처리 시 뒤엣것이 통째로 유실된다(URL 실화면 검증에서 확인).
              //   ★ 입력은 contentText(=URL fetch 본문 병합 결과) — rawInputText는 URL만 넣은 경우 URL 문자열
              //   자체라 파싱할 내용이 없다(URL 실화면 검증에서 성분 0건으로 확인).
              const fromProse = proseToCompetitorItems(contentText, { provider: proseProvider, krwPerUsd, fxMap })
                .filter((pi) => !fromPivot.some((pv) => pv.model_name === pi.model_name && pv.pricing_model === 'on_demand'))

              if (fromPivot.length > 0 || fromProse.length > 0) {
                compItems = [...fromPivot, ...fromProse] as unknown as Record<string, unknown>[]
                const parts: string[] = []
                if (fromPivot.length > 0) parts.push(`세로형 비교표 ${fromPivot.length}건(원본가+환율 환산)`)
                if (fromProse.length > 0) parts.push(`산문형 복합요금 ${fromProse.length}건(요금성분 ${fromProse.reduce((n, i) => n + (i.components?.length ?? 0), 0)}건 무손실)`)
                send('progress', { step: 'recovered', msg: `GPU 복원 — ${parts.join(' + ')}` })
              } else if (Array.isArray(classified.items)) {
                // 2순위 — 피벗도 실패하면 classify 모델만 복구(가격은 AI 불신 → 보류).
                const recovered = (classified.items as Array<Record<string, unknown>>)
                  .filter((it) => looksLikeGpuModel(String(it.model_name ?? '')))
                  .map((it) => {
                    const raw = String(it.model_name ?? '')
                    const canon = canonicalizeModel(raw).canonical || raw
                    return {
                      competitor_name: (typeof it.competitor_name === 'string' ? it.competitor_name : provider) || provider,
                      model_name: canon, ...(it.memory ? { memory: it.memory } : {}),
                      source_model_name: raw, price_usd: null, price_unknown: true,
                    }
                  })
                if (recovered.length > 0) {
                  compItems = recovered
                  send('progress', { step: 'recovered', msg: `분류결과에서 GPU 모델 ${recovered.length}건 복구 — 가격은 검수 필요` })
                }
              }
            }
            send('progress', { step: 'classified', msg: `경쟁사 가격 ${compItems.length}건 — 원문 모델명 그대로(전사 기반)${compItems.length < rawCount ? ` (중복 ${rawCount - compItems.length}건 제거)` : ''}` })
          } else if (Array.isArray(classified.items) && classified.items.length > 0) {
            // 폴백: 전사 실패 시 기존 classify.items(카탈로그 매핑) 경로 유지(회귀 0).
            const compDeduped = dedupCompetitor(classified.items as CompetitorLike[])
            rawCount = (classified.items as unknown[]).length
            compItems = compDeduped.map((it) => {
              const v = validateCompetitorItem(it, { preserveNoPrice: true })
              const original = typeof it.model_name === 'string' ? it.model_name.trim() : ''
              return { ...it, source_model_name: original || undefined, price_unknown: v.priceUnknown === true }
            })
            send('progress', { step: 'classified', msg: `경쟁사 가격 ${compItems.length}건 추출${compItems.length < rawCount ? ` (중복 ${rawCount - compItems.length}건 제거)` : ''}` })
          }

          if (compItems.length > 0) {
            send('preview', { type: 'competitor', items: compItems, source_url: sourceUrl })
            competitorEmitted = true
            if (!classified.supplier_present) {
              // 누락 감지는 distinct 모델 기준(2가격/모델 전개로 무력화되지 않게).
              const reconciliation = buildReconciliation(compItems as ReconcileExtractedLike[], true)
              send('done', { type: 'competitor', count: compItems.length, truncated: false, reconciliation })
              controller.close(); return
            }
            send('progress', { step: 'mixed', msg: '입력에 우리 공급 견적도 포함 — 공급가도 이어서 추출합니다.' })
          }
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
            send('done', { type: 'competitor', count: 0, truncated: false, reconciliation: null })
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
        // 보존: 원문(as-extracted) 모델명을 source_model_name으로 보존(카탈로그 매핑이 원문을 덮어쓰지 않게).
        const previewItems = items.map((it) => {
          const original = typeof it?.extracted?.model_name === 'string' ? (it.extracted.model_name as string).trim() : ''
          return original ? { ...it, source_model_name: original } : it
        })
        send('progress', { step: 'extracted', msg: `공급사 견적 ${items.length}건 추출 완료 — 미리보기 생성` })
        send('preview', { type: 'supplier', items: previewItems })
        // 행수 대조: 순수 공급가 입력에서만(혼합은 경쟁사/공급가가 한 표에 섞여 대조가 모호 → 생략).
        const supplierRecon = competitorEmitted
          ? null
          : buildReconciliation(items.map((it) => ({
              source_model_name: typeof it?.extracted?.model_name === 'string' ? (it.extracted.model_name as string) : null,
              model_name: typeof it?.extracted?.model_name === 'string' ? (it.extracted.model_name as string) : null,
            })))
        send('done', { type: competitorEmitted ? 'mixed' : 'supplier', count: items.length, truncated, reconciliation: supplierRecon })
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
