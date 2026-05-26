import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseLeadInput, parseLeadFromVision, isVisionMimeType, scoreFit } from '@/lib/gemini-lead'
import type { ParsedLeadData } from '@/lib/gemini-lead'
import { handleBulkMode, isBulkMimeType } from '@/lib/lead-bulk-import'

export const maxDuration = 300

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TEXT_BYTES = 100 * 1024
const MAX_XLSX_SHEETS = 10

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME  = 'application/vnd.ms-excel'
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/csv', 'text/tsv'])

const ALLOWED_EXTENSIONS = new Set([
  'jpg','jpeg','png','webp','gif','bmp','tiff','tif','heic','heif','avif',
  'pdf','docx','xlsx','xls','csv','txt',
])

function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

async function extractTextFromBuffer(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const lowerName = fileName.toLowerCase()

  if (mimeType === DOCX_MIME || lowerName.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer })
    const text = result.value
    return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text
  }

  if (mimeType === XLSX_MIME || mimeType === XLS_MIME || lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buffer)
    const sheets = workbook.SheetNames.slice(0, MAX_XLSX_SHEETS)
    const text = sheets.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n\n')
    return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text
  }

  const text = buffer.toString('utf-8')
  return text.length > MAX_TEXT_BYTES ? text.slice(0, MAX_TEXT_BYTES) : text
}

async function getSettings(adm: ReturnType<typeof createAdminClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsRes = await (adm as any).from('org_content').select('value').eq('key', 'META').single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (settingsRes.data?.value as any) ?? {}
  return {
    apiKey: (meta.gemini_api_key ?? process.env.GEMINI_API_KEY ?? '') as string,
    model: (meta.gemini_model ?? 'gemini-2.0-flash') as string,
  }
}

async function applyFitScore(parsed: ParsedLeadData, apiKey: string, model: string, userId?: string | null): Promise<ParsedLeadData> {
  if (!parsed.company_name) return parsed
  const fitResult = await scoreFit({
    name: parsed.company_name,
    industry: parsed.industry ?? null,
    segment: parsed.segment ?? null,
    size: parsed.size ?? null,
    region: parsed.region ?? null,
  }, apiKey, model, userId)
  return { ...parsed, fit_score: fitResult.fit_score, fit_reason: fitResult.fit_reason }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const contentType = req.headers.get('content-type') ?? ''

  // ── 파일 업로드 경로 ──────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const source = (formData.get('source') as string | null) ?? 'file'

    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ error: '빈 파일입니다' }, { status: 400 })
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: '파일 크기가 20MB를 초과합니다' }, { status: 413 })

    const ext = fileExtension(file.name)
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: `지원하지 않는 파일 형식입니다 (.${ext})` }, { status: 400 })
    }

    const { apiKey, model } = await getSettings(adminClient)
    if (!apiKey) return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 500 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType = file.type || 'application/octet-stream'

    // ── BULK_MODE 감지 (XLSX/XLS만) ────────────────────────
    if (isBulkMimeType(mimeType, ext)) {
      const bulkResponse = await handleBulkMode(buffer, file.name, user.id, adm, apiKey, model)
      const ctHeader = bulkResponse.headers.get('content-type') ?? ''
      if (ctHeader.includes('text/event-stream')) return bulkResponse
      const jsonBody = await bulkResponse.json() as { bulk?: boolean }
      if (jsonBody.bulk !== false) return bulkResponse
      // SINGLE_MODE fallthrough
    }

    try {
      let parsed: ParsedLeadData
      if (isVisionMimeType(mimeType) || ['jpg','jpeg','png','webp','gif','bmp','tiff','tif','heic','heif','avif','pdf'].includes(ext)) {
        const effectiveMime = mimeType !== 'application/octet-stream' ? mimeType
          : ext === 'pdf' ? 'application/pdf' : `image/${ext}`
        parsed = await parseLeadFromVision(buffer, effectiveMime, apiKey, model, user.id)
      } else if (TEXT_MIME_TYPES.has(mimeType) || mimeType === DOCX_MIME || mimeType === XLSX_MIME || mimeType === XLS_MIME ||
                 ['docx','xlsx','xls','csv','txt'].includes(ext)) {
        const text = await extractTextFromBuffer(buffer, mimeType, file.name)
        if (!text.trim()) return NextResponse.json({ error: '파일에서 텍스트를 추출할 수 없습니다' }, { status: 400 })
        parsed = await parseLeadInput(text, apiKey, model, user.id)
      } else {
        return NextResponse.json({ error: `지원하지 않는 파일 형식입니다 (.${ext})` }, { status: 400 })
      }

      parsed = await applyFitScore(parsed, apiKey, model, user.id)

      if (!parsed.company_name?.trim()) {
        const { error: failErr } = await adm.from('lead_intakes').insert({
          user_id: user.id, source, raw_input: file.name, status: 'failed', parsed_data: parsed, fit_score: null,
        })
        if (failErr) console.error('[lead-parse file failed-insert]', failErr)
        return NextResponse.json({ error: '파일에서 회사명 등 리드 정보를 추출하지 못했습니다. 명함·제안서·미팅메모 등 리드 관련 파일을 사용해주세요.' }, { status: 422 })
      }

      const { data: intake, error } = await adm.from('lead_intakes').insert({
        user_id: user.id, source, raw_input: file.name, status: 'completed',
        parsed_data: parsed, fit_score: parsed.fit_score ?? null,
      }).select().single()

      if (error) throw error
      return NextResponse.json({ success: true, intake, parsed })
    } catch (err) {
      console.error('[lead-parse file]', err)
      const { error: catchInsertErr } = await adm.from('lead_intakes').insert({
        user_id: user.id, source, raw_input: file.name, status: 'failed', parsed_data: null, fit_score: null,
      })
      if (catchInsertErr) console.error('[lead-parse file catch-insert]', catchInsertErr)
      return NextResponse.json({ error: '파일 분석 중 오류가 발생했습니다' }, { status: 500 })
    }
  }

  // ── 텍스트 입력 경로 (기존) ───────────────────────────────
  const body = await req.json() as { raw_input?: string; source?: string }
  const rawInput = body.raw_input ?? ''
  const source = body.source ?? 'prompt'

  if (!rawInput.trim()) return NextResponse.json({ error: '입력 내용이 없습니다' }, { status: 400 })

  const { apiKey, model } = await getSettings(adminClient)
  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 500 })

  try {
    let parsed = await parseLeadInput(rawInput, apiKey, model, user.id)
    parsed = await applyFitScore(parsed, apiKey, model, user.id)

    if (!parsed.company_name?.trim()) {
      const { error: failErr } = await adm.from('lead_intakes').insert({
        user_id: user.id, source, raw_input: rawInput, status: 'failed', parsed_data: parsed, fit_score: null,
      })
      if (failErr) console.error('[lead-parse text failed-insert]', failErr)
      return NextResponse.json({ error: '입력에서 회사명 등 리드 정보를 추출하지 못했습니다. 명함 정보, 미팅 메모, 이메일 등 리드 관련 내용을 입력해주세요.' }, { status: 422 })
    }

    const { data: intake, error } = await adm.from('lead_intakes').insert({
      user_id: user.id, source, raw_input: rawInput, status: 'completed',
      parsed_data: parsed, fit_score: parsed.fit_score ?? null,
    }).select().single()

    if (error) throw error
    return NextResponse.json({ success: true, intake, parsed })
  } catch (err) {
    console.error('[lead-parse text]', err)
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다' }, { status: 500 })
  }
}
