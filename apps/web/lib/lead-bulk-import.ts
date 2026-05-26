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
  const companyName = idx(['회사명'])
  if (companyName === undefined) return null
  return {
    companyName,
    industry: idx(['업종', '산업', '업태']),
    accountType: idx(['거래처유형', '고객유형', '유형']),
    gpuDemand: idx(['GPU수요강도', 'GPU 수요강도']),
    tier: idx(['Tier', 'tier', '티어']),
    businessJudge: idx(['사업', '판단']),
    region: idx(['소재지', '지역', '위치']),
    contactName: idx(['담당자']),
    contactTitle: idx(['직책', '직함']),
    contactPhone: idx(['연락처', '전화']),
    contactEmail: idx(['이메일', 'email', 'Email']),
    productRecommendation: idx(['추천제안', '추천', '제안']),
    dealValueBillion: idx(['딜밸류', '딜 밸류', '예상딜', '밸류(억']),
    fitScore: idx(['적합도', '적합']),
    notes: idx(['비고', '메모', '노트']),
  }
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
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const allRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][]

  if (allRows.length < 2) {
    return NextResponse.json({ error: '데이터 행이 없습니다' }, { status: 400 })
  }

  const headers = (allRows[0] as string[]).map(String)
  const colMap = detectBulkMode(headers)
  if (!colMap) {
    return NextResponse.json({ bulk: false }, { status: 200 })
  }

  const dataRows = allRows.slice(1).filter(row => (row as string[]).some(cell => String(cell).trim()))
  const total = dataRows.length
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      send({ type: 'start', total, fileName })

      let success = 0
      let failed = 0
      const intakeIds: string[] = []

      for (let chunkStart = 0; chunkStart < total; chunkStart += BULK_CHUNK_SIZE) {
        const chunk = dataRows.slice(chunkStart, chunkStart + BULK_CHUNK_SIZE) as string[][]
        let parsedChunk: ParsedLeadData[]

        try {
          parsedChunk = await parseBulkLeadChunk(chunk, colMap, apiKey, model, userId, chunkStart)
        } catch {
          parsedChunk = chunk.map((_, i) => ({ bulk_import_row: chunkStart + i + 1 }))
        }

        for (const item of parsedChunk) {
          const hasName = item.company_name?.trim()
          const status = hasName ? 'completed' : 'failed'
          try {
            const { data: intake } = await adm.from('lead_intakes').insert({
              user_id: userId,
              source: 'xlsx_bulk',
              raw_input: fileName,
              status,
              parsed_data: item,
              fit_score: item.fit_score ?? null,
            }).select('id').single()
            if (intake?.id) intakeIds.push(intake.id)
            if (status === 'completed') success++; else failed++
          } catch {
            failed++
          }
        }

        send({ type: 'progress', processed: Math.min(chunkStart + BULK_CHUNK_SIZE, total), total, success, failed })

        if (chunkStart + BULK_CHUNK_SIZE < total) {
          await new Promise(r => setTimeout(r, 1000))
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
