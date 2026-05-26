import { NextResponse } from 'next/server'
import { parseBulkLeadChunk } from '@/lib/gemini-lead'
import type { ParsedLeadData, ColumnIndexMap } from '@/lib/gemini-lead'

const BULK_CHUNK_SIZE = 10
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME  = 'application/vnd.ms-excel'

export function detectBulkMode(headers: string[]): ColumnIndexMap | null {
  const idx = (names: string[]): number | undefined => {
    const i = headers.findIndex(h => names.some(n => h.trim().includes(n)))
    return i === -1 ? undefined : i
  }
  const companyName = idx(['회사명', '기관명'])
  if (companyName === undefined) return null
  const sourceKind = idx(['기관명', '기관유형', '사업명', '발주시기']) !== undefined ? 'public' : 'private'
  return {
    companyName,
    registrationNumber: idx(['사업자번호', '기관번호', '고유번호']),
    industry: idx(['업종', '산업', '업태']),
    accountType: idx(['거래처유형', '고객유형', '기관유형', '유형']),
    gpuDemand: idx(['GPU수요강도', 'GPU 수요강도']),
    tier: idx(['Tier', 'tier', '티어']),
    businessJudge: idx(['사업(판단)', '사업', '판단', '사업개요']),
    region: idx(['소재지', '지역', '위치']),
    contactName: idx(['담당자']),
    contactTitle: idx(['직책', '직함']),
    contactPhone: idx(['연락처', '전화']),
    contactEmail: idx(['이메일', 'email', 'Email']),
    dealTitle: idx(['사업명', '품목명', '기회명']),
    productRecommendation: idx(['추천제안', 'gcube 제안각도', '제안각도', '추천', '제안']),
    dealValueBillion: idx(['딜밸류', '딜 밸류', '예상딜', '밸류(억', '당해금액', '총사업금액', 'HW예산', '구매예산', '예산']),
    expectedDate: idx(['발주시기', '예상시기', '마감']),
    newOrContinue: idx(['신규/계속', '신규', '계속']),
    hwIncluded: idx(['HW도입', 'HW도입여부', 'HW 포함']),
    fundingSource: idx(['재원']),
    procurementStatus: idx(['발주여부', '발주']),
    fitScore: idx(['적합도', '적합']),
    notes: idx(['비고', '메모', '노트']),
    sourceKind,
  }
}

type SheetRows = {
  rows: string[][]
  colMap: ColumnIndexMap
}

export async function handleBulkMode(
  buffer: Buffer,
  fileName: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adm: any,
  apiKey: string,
  model: string
): Promise<Response> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer)
  const sheetRows: SheetRows[] = []
  let sawRows = false

  for (const sheetName of workbook.SheetNames) {
    if (sheetName.trim() === '요약') continue
    const sheet = workbook.Sheets[sheetName]
    const allRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]
    if (allRows.length < 2) continue
    sawRows = true
    const headers = (allRows[0] as string[]).map(String)
    const colMap = detectBulkMode(headers)
    if (!colMap) continue
    const rows = allRows.slice(1).filter(row => (row as string[]).some(cell => String(cell).trim())) as string[][]
    if (rows.length > 0) sheetRows.push({ rows, colMap })
  }

  if (sheetRows.length === 0) {
    return sawRows
      ? NextResponse.json({ bulk: false }, { status: 200 })
      : NextResponse.json({ error: '데이터 행이 없습니다' }, { status: 400 })
  }

  const total = sheetRows.reduce((sum, s) => sum + s.rows.length, 0)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      send({ type: 'start', total, fileName })

      let success = 0
      let failed = 0
      const intakeIds: string[] = []

      let processed = 0

      for (const group of sheetRows) {
        for (let chunkStart = 0; chunkStart < group.rows.length; chunkStart += BULK_CHUNK_SIZE) {
          const chunk = group.rows.slice(chunkStart, chunkStart + BULK_CHUNK_SIZE)
          let parsedChunk: ParsedLeadData[]

          try {
            parsedChunk = await parseBulkLeadChunk(chunk, group.colMap, apiKey, model, userId, processed)
          } catch {
            parsedChunk = chunk.map((_, i) => ({ bulk_import_row: processed + i + 1 }))
          }

          for (const item of parsedChunk) {
            const hasName = item.company_name?.trim()
            const status = hasName ? 'completed' : 'failed'
            try {
              const { data: intake } = await adm.from('lead_intakes').insert({
                user_id: userId,
                source: 'xlsx_bulk',
                raw_input: fileName,
                original_file_name: fileName,
                status,
                parsed_data: { ...item, source: group.colMap.sourceKind === 'public' ? '공공수요예보' : '민간DB' },
                fit_score: item.fit_score ?? null,
              }).select('id').single()
              if (intake?.id) intakeIds.push(intake.id)
              if (status === 'completed') success++; else failed++
            } catch {
              failed++
            }
          }

          processed += chunk.length
          send({ type: 'progress', processed, total, success, failed })

          if (processed < total) {
            await new Promise(r => setTimeout(r, 1000))
          }
        }
      }

      send({ type: 'done', processed: total, success, failed, intakeIds })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

export function isBulkMimeType(mimeType: string, ext: string): boolean {
  return mimeType === XLSX_MIME || mimeType === XLS_MIME || ext === 'xlsx' || ext === 'xls'
}
