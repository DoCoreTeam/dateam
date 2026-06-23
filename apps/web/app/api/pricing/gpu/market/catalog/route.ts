import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { parseCatalogBuffer } from '@/lib/gpu/catalog-parse'
import { validateMapping, applyMapping } from '@/lib/gpu/catalog-map'
import { dedupCompetitor } from '@/lib/gpu/dedup'
import { partitionValid, validateCompetitorItem } from '@/lib/gpu/validate'
import { getGeminiConfig, loadSchemaDigest, loadSpecContext, callGeminiOnce } from '@/lib/gpu/extract-helpers'
import { orchestrateUsai, type CallAI } from '@/lib/gpu/usai-orchestrate'
import { storeGpuEvidence } from '@/lib/gpu/evidence-store'

// POST /api/pricing/gpu/market/catalog — 카탈로그 파일(xlsx/csv) AI 자동 흡수.
//  multipart/form-data: file(File), is_test('true'|'false')
//  흐름: 파싱 → AI 헤더매핑 1회(실패 시 프롬프트 보강 재시도) → 코드가 전체 행 결정적 변환
//        → dedup/validate → review_items(target=competitor, channel=catalog) 적재. 자동반영 X(검토대기 게이트).

const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5MB 상한
const MAX_INSERT = 500                   // 1회 적재 상한(런어웨이/오염 방지)

async function getMapPrompt(adminClient: ReturnType<typeof createAdminClient>): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('ai_prompts').select('content').eq('prompt_key', 'gpu.catalog-map').eq('active', true).single()
  return typeof data?.content === 'string' ? data.content : null
}

// USAI: prompt_key → 활성 프롬프트 본문
async function getPromptContent(adminClient: ReturnType<typeof createAdminClient>, key: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('ai_prompts').select('content').eq('prompt_key', key).eq('active', true).single()
  return typeof data?.content === 'string' ? data.content : null
}

// USAI: 최신 매매기준율(1 USD = ? KRW)
async function getKrwPerUsd(adminClient: ReturnType<typeof createAdminClient>): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).single()
  const n = typeof data?.usd_krw === 'number' ? data.usd_krw : 0
  // 합리범위 밖(비정상 환율) → 폴백. 0.0005 같은 garbage 단가 유입 차단(SEC-M2).
  return n >= 800 && n <= 3000 ? n : 1500
}

// USAI 흡수 경로 — 좌표격자→AI구조발견→블록추출→정규화→자기일관성→분류→review_items 적재.
async function runUsaiCatalog(
  buf: ArrayBuffer,
  adminClient: ReturnType<typeof createAdminClient>,
  config: { apiKey: string; model: string },
  isTest: boolean,
  actor: string,
  evidenceFileId: string | null,
): Promise<NextResponse> {
  const [discoverPrompt, extractPrompt, krwPerUsd] = await Promise.all([
    getPromptContent(adminClient, 'gpu.intake-discover'),
    getPromptContent(adminClient, 'gpu.intake-extract-block'),
    getKrwPerUsd(adminClient),
  ])
  if (!discoverPrompt || !extractPrompt) {
    return NextResponse.json({ error: 'USAI 프롬프트 미설정(migration 122)' }, { status: 500 })
  }

  // 일시적 AI 오류(429/5xx)는 최대 2회 재시도(지수 백오프). 영구 오류는 즉시 전파.
  const callAI: CallAI = async (promptKey, ctx) => {
    const base = promptKey === 'gpu.intake-discover' ? discoverPrompt : extractPrompt
    const prompt = `${base}\n\n${ctx}`
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callGeminiOnce(config.apiKey, config.model, prompt, true)
      } catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : ''
        const transient = /\b(429|500|502|503|504)\b/.test(msg)
        if (!transient || attempt === 2) throw e
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      }
    }
    throw lastErr
  }

  let result
  try { result = await orchestrateUsai(buf, { callAI, krwPerUsd }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'USAI 처리 실패' }, { status: 422 }) }

  const valid = result.items.filter((it) => it.unit_price_usd > 0 && it.model_name)
  const items = valid.slice(0, MAX_INSERT)
  if (items.length === 0) {
    return NextResponse.json({ error: 'USAI: 추출/검증을 통과한 가격 레코드가 없습니다', blocks: result.blocks.length, meta: result.meta }, { status: 422 })
  }

  const batchId = crypto.randomUUID()
  const insertRows = items.map((it, idx) => ({
    source_batch_id: items.length > 1 ? batchId : null,
    batch_index: idx,
    target: it.target,           // own_target | competitor | supplier (AI 분류)
    channel: 'catalog',
    impact_level: 'steady',
    status: 'pending',
    current_iteration: 1,
    current_extracted: {
      model_name: it.model_name,
      unit_price_usd: it.unit_price_usd,
      price_usd: it.unit_price_usd,          // competitor confirm 호환 투영
      original_price: it.original_price,
      original_currency: it.original_currency,
      original_unit: it.original_unit,
      gpu_count: it.gpu_count,
      term: it.term,
      provenance: it.provenance,
      usai: { needs_human: it.needs_human, verify_flags: it.verify_flags, issues: it.issues, block_id: it.provenance.block_id },
    },
    overall_confidence: Math.round((it.confidence || 0) * 100),
    product_hint: it.model_name,
    supplier_hint: null,
    evidence_drive_file_id: evidenceFileId,
    is_test: isTest,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (adminClient as any).from('review_items').insert(insertRows).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const arr = (inserted ?? []) as Array<{ id: string }>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor,
    action_type: 'usai_intake',
    detail: {
      engine: 'usai', batch_id: batchId, is_test: isTest,
      blocks: result.blocks.length, price_blocks: result.meta.priceBlocks, sheets: result.meta.sheets,
      raw_records: result.meta.rawRecords, inserted: arr.length,
      needs_human: items.filter((i) => i.needs_human).length,
      targets: items.reduce<Record<string, number>>((a, i) => { a[i.target] = (a[i.target] || 0) + 1; return a }, {}),
    },
  }).then(undefined, () => {})

  return NextResponse.json({
    ok: true, engine: 'usai', count: arr.length,
    needs_human: items.filter((i) => i.needs_human).length,
    blocks: result.blocks.length, meta: result.meta,
    sample: items.slice(0, 5),
  })
}

export async function POST(req: NextRequest) {
  // 통합입력 제출(엑셀/CSV 흡수) — 내부 임직원(admin+member) 허용. review_items(검토대기 staging)에만 적재.
  // 라이브 반영/확정(market/import·review 승인)은 admin 유지 — 제출↔확정 권한 분리.
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const user = auth.user

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: '파일 업로드 형식 오류' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: '빈 파일입니다' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `파일이 너무 큽니다(최대 ${MAX_FILE_BYTES / 1024 / 1024}MB)` }, { status: 413 })
  const isTest = String(form.get('is_test')) === 'true'

  const buf = await file.arrayBuffer()
  const adminClient = createAdminClient()
  const config = await getGeminiConfig(adminClient)
  if (!config.apiKey) return NextResponse.json({ error: 'AI 키 미설정' }, { status: 500 })

  // 원본데이터 보관 — Drive 연결 시 원본을 보관하고 file id를 검토 항목에 연결(역추적).
  // 미연결/실패여도 추출은 계속(부분 degrade). 운영 오염 방지 위해 is_test 무관 보관(검토단계 산출물).
  const evidence = await storeGpuEvidence({ buffer: Buffer.from(buf), filename: file.name, mimeType: file.type })
  const evidenceFileId = evidence.fileId

  // USAI 흡수 경로(flag ON 시) — 비정형 다중블록을 AI 주도로. 기본 OFF면 레거시 평면표 경로.
  if (process.env.GPU_USAI_INGEST === '1') {
    return runUsaiCatalog(buf, adminClient, config, isTest, user.email ?? user.id, evidenceFileId)
  }

  // 1) 파싱 — 첫 시트 헤더·행·샘플 (레거시 경로)
  let parsed
  try { parsed = parseCatalogBuffer(buf) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '파일을 읽지 못했습니다(xlsx/csv 형식 확인)' }, { status: 422 }) }
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    return NextResponse.json({ error: '표 데이터(헤더+행)를 찾지 못했습니다' }, { status: 422 })
  }

  const [schemaDigest, specContext, basePrompt] = await Promise.all([
    loadSchemaDigest(adminClient), loadSpecContext(adminClient), getMapPrompt(adminClient),
  ])
  if (!basePrompt) return NextResponse.json({ error: '카탈로그 매핑 프롬프트 미설정(migration 090)' }, { status: 500 })

  // 2) AI 헤더 매핑 1회 — 헤더+샘플만 전송(전행 아님). 실패 시 프롬프트 보강 후 1회 재시도("AI가 프롬프트를 바꿔가며").
  const ctx = `${schemaDigest}${specContext}\n\n[헤더 목록]\n${JSON.stringify(parsed.headers)}\n\n[샘플 행]\n${JSON.stringify(parsed.sample)}`
  let mapping = null
  let synthesized = false
  try { mapping = validateMapping(JSON.parse(await callGeminiOnce(config.apiKey, config.model, `${basePrompt}\n\n${ctx}`, true)), parsed.headers) }
  catch { /* fallthrough to retry */ }

  if (!mapping) {
    synthesized = true
    const augmented = `${basePrompt}\n\n【재시도 — 더 엄격히】 앞선 매핑이 필수 필드(업체명·모델명·가격)를 찾지 못했습니다. 각 헤더를 하나씩 검토해, 업체/지역 복합 컬럼(예 location)·모델명 컬럼·가격 컬럼을 반드시 식별하세요. 값이 "업체/지역" 형태면 _location_split=true. 반드시 competitor_name·model_name·price_usd를 채우세요.`
    try { mapping = validateMapping(JSON.parse(await callGeminiOnce(config.apiKey, config.model, `${augmented}\n\n${ctx}`, true)), parsed.headers) }
    catch { /* still null */ }
  }
  if (!mapping) {
    return NextResponse.json({ error: 'AI가 이 파일의 컬럼을 우리 스키마(업체·모델·가격)에 매핑하지 못했습니다. 헤더를 확인해 주세요.', headers: parsed.headers }, { status: 422 })
  }

  // 3) 코드가 전체 행 결정적 변환 → 4) dedup → validate
  const transformed = applyMapping(parsed.rows, mapping)
  const deduped = dedupCompetitor(transformed)
  const { passed, blocked } = partitionValid(deduped, validateCompetitorItem)
  const items = passed.slice(0, MAX_INSERT)
  if (items.length === 0) {
    return NextResponse.json({ error: '검증을 통과한 행이 없습니다', blocked: blocked.slice(0, 5).map((b) => b.issues), mapping }, { status: 422 })
  }

  // 5) 검토대기(review_items) 적재 — target=competitor, channel=catalog. 자동반영 X.
  const batchId = crypto.randomUUID()
  const insertRows = items.map((it, idx) => ({
    source_batch_id: items.length > 1 ? batchId : null,
    batch_index: idx,
    target: 'competitor',
    channel: 'catalog',
    impact_level: 'steady',
    status: 'pending',
    current_iteration: 1,
    current_extracted: it,
    overall_confidence: mapping._confidence,
    product_hint: `${it.model_name}${it.memory ? ' ' + it.memory : ''}`.trim(),
    supplier_hint: it.competitor_name,
    evidence_drive_file_id: evidenceFileId,
    is_test: isTest,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (adminClient as any).from('review_items').insert(insertRows).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const arr = (inserted ?? []) as Array<{ id: string }>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: user.email ?? user.id,
    action_type: 'catalog_intake',
    detail: {
      file: file.name, total_rows: parsed.totalRows, truncated: parsed.truncated,
      transformed: transformed.length, deduped: deduped.length, inserted: arr.length, blocked: blocked.length,
      mapping, ai: { prompt_key: 'gpu.catalog-map', synthesized }, is_test: isTest, batch_id: batchId,
    },
  }).then(undefined, () => {})

  return NextResponse.json({
    ok: true,
    count: arr.length,
    blocked: blocked.length,
    total_rows: parsed.totalRows,
    truncated: parsed.truncated,
    mapping,
    sample: items.slice(0, 5),
    ai: { prompt_key: 'gpu.catalog-map', synthesized },
  })
}
