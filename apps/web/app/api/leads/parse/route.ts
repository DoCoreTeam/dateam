import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { parseLeadInput, parseLeadFromVision, isVisionMimeType, scoreFit } from '@/lib/gemini-lead'
import type { ParsedLeadData } from '@/lib/gemini-lead'

const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/csv', 'text/tsv',
])

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME  = 'application/vnd.ms-excel'

async function extractTextFromBuffer(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const lowerName = fileName.toLowerCase()

  if (mimeType === DOCX_MIME || lowerName.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (
    mimeType === XLSX_MIME || mimeType === XLS_MIME ||
    lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
  ) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(buffer)
    return workbook.SheetNames
      .map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name]))
      .join('\n\n')
  }

  return buffer.toString('utf-8')
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

    const { apiKey, model } = await getSettings(adminClient)
    if (!apiKey) return NextResponse.json({ error: 'Gemini API 키가 설정되지 않았습니다' }, { status: 500 })

    try {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const mimeType = file.type || 'application/octet-stream'

      let parsed: ParsedLeadData
      if (isVisionMimeType(mimeType)) {
        parsed = await parseLeadFromVision(buffer, mimeType, apiKey, model, user.id)
      } else if (TEXT_MIME_TYPES.has(mimeType) || mimeType === DOCX_MIME || mimeType === XLSX_MIME || mimeType === XLS_MIME ||
                 file.name.match(/\.(txt|csv|docx|xlsx|xls)$/i)) {
        const text = await extractTextFromBuffer(buffer, mimeType, file.name)
        if (!text.trim()) return NextResponse.json({ error: '파일에서 텍스트를 추출할 수 없습니다' }, { status: 400 })
        parsed = await parseLeadInput(text, apiKey, model, user.id)
      } else {
        return NextResponse.json({ error: `지원하지 않는 파일 형식입니다: ${mimeType}` }, { status: 400 })
      }

      parsed = await applyFitScore(parsed, apiKey, model, user.id)

      const { data: intake, error } = await adm.from('lead_intakes').insert({
        user_id: user.id,
        source,
        raw_input: file.name,
        status: 'completed',
        parsed_data: parsed,
        fit_score: parsed.fit_score ?? null,
      }).select().single()

      if (error) throw error
      return NextResponse.json({ success: true, intake, parsed })
    } catch (err) {
      const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다'
      return NextResponse.json({ error: message }, { status: 500 })
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

    const { data: intake, error } = await adm.from('lead_intakes').insert({
      user_id: user.id,
      source,
      raw_input: rawInput,
      status: 'completed',
      parsed_data: parsed,
      fit_score: parsed.fit_score ?? null,
    }).select().single()

    if (error) throw error
    return NextResponse.json({ success: true, intake, parsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
