/**
 * 견적서 → 엑셀 (xlsx)
 *
 * **왜 CSV 가 아닌가**: CSV 에는 서식이 없다. 고객이 열면 셀에 글자만 흩어져 있고
 * 「견 적 서」 배치도, 금액의 자릿수 정렬도, 한글 금액도, 인쇄 영역도 전부 사라진다.
 * 목록 내보내기(회사·딜)는 **우리가 엑셀에서 계산하려고** 받는 것이라 CSV 가 맞지만,
 * 견적서는 **고객이 읽고 결재하는 문서**다. 성격이 다르다.
 * (사용자 지적: 「csv 쓰는 회사 없어」)
 *
 * **왜 exceljs 인가**: 이미 있는 SheetJS(`xlsx@0.18`) 커뮤니티판은 병합·열 너비까지만 되고
 * **폰트·테두리·정렬·이미지는 유료판 기능**이다. 로고와 직인을 넣어야 하므로 여기서는 못 쓴다.
 * SheetJS 는 GPU 카탈로그를 **읽는** 데 계속 쓰인다 — 걷어내지 않는다.
 *
 * **이 파일도 원가를 모른다.** 입력이 `QuoteDocument` 뿐이고, 그 타입에 원가 자리가 없다.
 */

import type { QuoteDocument } from '../domain/quote-document.ts'
import { QUOTE, SUPPLIER_ORDER, SUPPLIER_LABEL } from '../../terms/quote.ts'
import { minorDigits, currencyAffix } from '../../../app/(crm)/crm/deals/amount.ts'

/** 항목 표의 열 — 화면(§견적서)과 **같은 순서**다. 다르면 같은 문서가 아니다 */
const COLUMNS = [
  { key: 'no', label: QUOTE.lineNo, width: 5 },
  { key: 'name', label: QUOTE.lineName, width: 40 },
  { key: 'unit', label: QUOTE.lineUnit, width: 7 },
  { key: 'qty', label: QUOTE.lineQuantity, width: 8 },
  { key: 'price', label: QUOTE.lineUnitPrice, width: 17 },
  { key: 'disc', label: QUOTE.lineDiscount, width: 8 },
  { key: 'amount', label: QUOTE.lineAmount, width: 20 },
] as const

const LAST_COL = 'G'          // COLUMNS 의 마지막 열
const HAIRLINE = 'FFD8DCE3'   // 표 테두리
const HEAD_BG = 'FFF2F4F7'    // 표 머리글 배경
const MUTED = 'FF6B7280'      // 보조 글자

function money(minor: string, currency: string): number | string {
  const digits = minorDigits(currency)
  const n = Number(minor) / 10 ** digits
  // 2^53 을 넘으면 숫자로 쓰면 값이 조용히 틀어진다 — 그럴 땐 문자열로 둔다
  return Number.isSafeInteger(Number(minor)) && Number.isFinite(n) ? n : minor
}

/**
 * 엑셀 셀 서식.
 *
 * **값은 숫자로 두고 서식으로 통화를 붙인다.** 「548,375,000원」을 문자열로 넣으면
 * 받은 사람이 엑셀에서 더할 수 없다 — 견적서를 받아 자기 예산표에 옮기는 것이 흔한 일이다.
 * 서식이면 화면엔 「548,375,000원」이 보이고 셀 값은 그대로 숫자다.
 *
 * 접미사·접두사는 화면과 **같은 SSOT**(currencyAffix)에서 온다 —
 * 엑셀만 「KRW」라고 쓰면 같은 문서가 아니다.
 */
function numFmt(currency: string): string {
  const base = minorDigits(currency) === 0 ? '#,##0' : '#,##0.00'
  const { prefix, suffix } = currencyAffix(currency)
  const p = prefix ? `"${prefix}"` : ''
  const t = suffix ? `"${suffix}"` : ''
  return `${p}${base}${t}`
}

/** `data:image/png;base64,…` 를 exceljs 가 받는 모양으로. 아니면 null */
function parseImage(dataUri: string): { base64: string; extension: 'png' | 'jpeg' } | null {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri || '')
  return m ? { base64: m[2], extension: m[1] as 'png' | 'jpeg' } : null
}

export interface QuoteXlsxInput {
  document: QuoteDocument
  /** 설정에서 온 로고(data URI). 없으면 빈 문자열 */
  logo?: string
}

export interface QuoteXlsxResult {
  filename: string
  buffer: Buffer
}

export async function quoteDocumentToXlsx(input: QuoteXlsxInput): Promise<QuoteXlsxResult> {
  // 동적 import — 견적서를 안 뽑는 요청까지 엑셀 라이브러리를 물고 시작하지 않게
  const ExcelJS = (await import('exceljs')).default
  const doc = input.document
  const cur = doc.meta.currency
  const fmt = numFmt(cur)

  const wb = new ExcelJS.Workbook()
  wb.creator = doc.supplier.name || QUOTE.documentTitle
  const ws = wb.addWorksheet(QUOTE.documentTitle, {
    pageSetup: {
      paperSize: 9,               // A4
      orientation: 'portrait',
      // **가로로 한 장에 맞춘다.** 세로는 항목 수만큼 넘어가도 된다 —
      // 가로가 잘리면 금액 열이 다음 장으로 넘어가 문서가 못 읽힌다
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  })

  ws.columns = COLUMNS.map((c) => ({ width: c.width }))

  /*
    **눈금선을 끈다.** 이것 하나로 「스프레드시트」가 「문서」가 된다 —
    격자가 보이면 받은 사람 눈에는 셀에 값이 흩어져 있는 것으로 읽힌다
    (실측: 사용자가 받아 열고 「그대로네 디자인은」이라고 했다).
  */
  ws.views = [{ showGridLines: false }]

  /** 한글은 한 글자가 두 칸을 먹는다 — 줄 수를 세어 행 높이를 정한다 */
  const wrapHeight = (text: string, colWidth: number, base = 15): number => {
    const w = Array.from(text).reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)
    const lines = Math.max(1, Math.ceil(w / Math.max(4, colWidth * 2 - 2)))
    return base * lines
  }

  const border = {
    top: { style: 'thin' as const, color: { argb: HAIRLINE } },
    left: { style: 'thin' as const, color: { argb: HAIRLINE } },
    bottom: { style: 'thin' as const, color: { argb: HAIRLINE } },
    right: { style: 'thin' as const, color: { argb: HAIRLINE } },
  }

  let r = 1

  // ── 로고 ────────────────────────────────────────────────
  const logo = parseImage(input.logo ?? '')
  if (logo) {
    const id = wb.addImage(logo)
    // 제목 위 왼쪽. 행 높이를 함께 키우지 않으면 이미지가 표를 덮는다
    ws.getRow(r).height = 42
    ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: 150, height: 48 } })
    r += 1
  }

  // ── 제목 ────────────────────────────────────────────────
  ws.mergeCells(`A${r}:${LAST_COL}${r}`)
  const title = ws.getCell(`A${r}`)
  // 엑셀에는 자간(letter-spacing)이 없다 — 화면의 「견 적 서」와 같아 보이게 공백을 넣는다
  title.value = Array.from(QUOTE.documentTitle).join(' ')
  title.font = { size: 22, bold: true }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(r).height = 36
  r += 2

  // ── 두 당사자 ───────────────────────────────────────────
  // 화면에서는 테두리 박스 둘이 나란히 선다. 엑셀에서도 같아야 «같은 문서»다 —
  // 테두리가 없으면 값이 허공에 떠 있는 것처럼 보인다.
  const partyTop = r
  ws.getCell(`A${r}`).value = QUOTE.customer
  ws.getCell(`A${r}`).font = { size: 9, bold: true, color: { argb: MUTED } }
  ws.getCell(`E${r}`).value = QUOTE.supplier
  ws.getCell(`E${r}`).font = { size: 9, bold: true, color: { argb: MUTED } }
  r += 1

  ws.mergeCells(`A${r}:C${r}`)
  ws.getCell(`A${r}`).value = `${doc.customer.companyName} ${QUOTE.customerHonorific}`
  ws.getCell(`A${r}`).font = { size: 14, bold: true }

  // 담당자·건명 — 인쇄본에는 나오는데 엑셀에만 빠지면 **같은 문서가 아니다**
  const customerRowsData: [string, string][] = []
  if (doc.customer.personName) customerRowsData.push([QUOTE.supplierContact, doc.customer.personName])
  customerRowsData.push([QUOTE.subject, doc.meta.title])

  customerRowsData.forEach(([label, value], i) => {
    const row = r + 1 + i
    ws.getCell(`A${row}`).value = label
    ws.getCell(`A${row}`).font = { size: 9, color: { argb: MUTED } }
    ws.mergeCells(`B${row}:C${row}`)
    ws.getCell(`B${row}`).value = value
    ws.getCell(`B${row}`).font = { size: 10 }
    ws.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' }
  })

  // 공급자는 «비어 있지 않은 것만» 줄을 만든다 — 「—」 가 늘어선 문서를 보내지 않는다
  const filled = SUPPLIER_ORDER.filter((f) => doc.supplier[f] !== '')
  filled.forEach((f, i) => {
    const row = r + i
    ws.getCell(`E${row}`).value = SUPPLIER_LABEL[f]
    ws.getCell(`E${row}`).font = { size: 9, color: { argb: MUTED } }
    ws.mergeCells(`F${row}:${LAST_COL}${row}`)
    ws.getCell(`F${row}`).value = doc.supplier[f]
    ws.getCell(`F${row}`).font = { size: 10 }
    ws.getCell(`F${row}`).alignment = { wrapText: true, vertical: 'top' }
  })

  // ── 날인 자리 — 도장 이미지 대신 문구 ────────────────────
  // 전자로 보내는 문서에 도장을 박으면 받은 사람이 오려내 다른 문서에 쓸 수 있다.
  // 「(직인생략)」은 실무 관례이고, 그 표기 자체가 «원본에는 날인이 있다»는 뜻으로 통용된다.
  {
    const cell = ws.getCell(`${LAST_COL}${partyTop}`)
    cell.value = QUOTE.sealOmitted
    cell.font = { size: 10, color: { argb: MUTED } }
    cell.alignment = { horizontal: 'right' }
  }

  // 고객 쪽(회사 + 부속 줄)과 공급자 쪽(채운 항목 수) 중 **긴 쪽**을 따라간다
  const partyBottom = Math.max(r + customerRowsData.length, partyTop + filled.length)

  // 긴 값(주소·종목·담당)은 한 줄에 안 들어간다 — 행 높이를 안 키우면 **잘려서 인쇄된다**
  for (let row = partyTop; row <= partyBottom; row += 1) {
    const texts = [String(ws.getCell(`B${row}`).value ?? ''), String(ws.getCell(`F${row}`).value ?? '')]
    // 병합된 실제 폭을 넘긴다 — 좁게 잡으면 안 줄여도 될 행을 키우고,
    // 넓게 잡으면 넘치는 글자가 **잘린 채로 인쇄된다**
    const mergedWidth = (COLUMNS[1].width + COLUMNS[2].width)
    const need = Math.max(...texts.map((t) => wrapHeight(t, mergedWidth)))
    if (need > 15) ws.getRow(row).height = need
  }

  // 두 박스에 테두리 — 왼쪽 A:C, 오른쪽 E:G
  const box = { style: 'thin' as const, color: { argb: HAIRLINE } }
  const BOXES: readonly [number, number][] = [[1, 3], [5, 7]]
  for (const [from, to] of BOXES) {
    for (let row = partyTop; row <= partyBottom; row += 1) {
      for (let col = from; col <= to; col += 1) {
        const cell = ws.getCell(row, col)
        cell.border = {
          top: row === partyTop ? box : undefined,
          bottom: row === partyBottom ? box : undefined,
          left: col === from ? box : undefined,
          right: col === to ? box : undefined,
        }
      }
    }
  }

  r = partyBottom + 2

  // ── 문서 메타 ───────────────────────────────────────────
  // **통화 줄은 없다.** 금액 칸마다 「원」·「$」가 붙으므로 중복이고,
  // 한국어 문서에서 「통화 KRW」라고 쓰는 곳도 없다(화면에도 그 줄이 없다).
  const meta: [string, string][] = ([
    [QUOTE.quoteNo, doc.meta.quoteNo],
    [QUOTE.issuedOn, doc.meta.issuedOn ?? ''],
    [QUOTE.validUntil, doc.meta.validUntil ?? ''],
  ] as [string, string][]).filter(([, v]) => v !== '')

  meta.forEach(([label, value], i) => {
    const col = String.fromCharCode(65 + i * 2)      // A, C, E, G
    const next = String.fromCharCode(66 + i * 2)
    ws.getCell(`${col}${r}`).value = label
    ws.getCell(`${col}${r}`).font = { size: 9, color: { argb: MUTED } }
    ws.getCell(`${next}${r}`).value = value
    ws.getCell(`${next}${r}`).font = { size: 10, bold: true }
  })
  r += 2

  // ── 항목 표 ─────────────────────────────────────────────
  const headRow = r
  COLUMNS.forEach((c, i) => {
    const cell = ws.getCell(headRow, i + 1)
    cell.value = c.label
    cell.font = { size: 10, bold: true, color: { argb: MUTED } }
    cell.alignment = { horizontal: i >= 3 ? 'right' : 'left', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } }
    cell.border = border
  })
  ws.getRow(headRow).height = 22
  r += 1

  for (const line of doc.lines) {
    // 규격은 품목 아래 줄바꿈으로 붙인다 — 별도 열을 만들면 표가 가로로 넘친다
    const name = line.spec ? `${line.name}\n${line.spec}` : line.name
    const values: (string | number)[] = [
      line.no,
      name,
      line.unit ?? '',
      Number(line.quantity),
      money(line.unitPriceMinor, cur),
      line.discountPercent === '0' ? '' : `${line.discountPercent}%`,
      money(line.amountMinor, cur),
    ]
    values.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v
      cell.border = border
      cell.font = { size: 10 }
      if (i === 1) cell.alignment = { wrapText: true, vertical: 'top' }
      else if (i >= 3) cell.alignment = { horizontal: 'right', vertical: 'top' }
      else cell.alignment = { vertical: 'top' }
      if (i === 4 || i === 6) cell.numFmt = fmt
    })
    // 품목+규격이 두 줄이라 높이를 준다. 긴 품목명은 더 필요할 수 있다
    ws.getRow(r).height = Math.max(line.spec ? 30 : 18, wrapHeight(name, 40, 15))
    r += 1
  }
  const lastLineRow = r - 1
  r += 1

  // ── 합계 ────────────────────────────────────────────────
  const totals: [string, string, boolean][] = [
    [QUOTE.subtotal, doc.totals.subtotalMinor, false],
    [QUOTE.discount, doc.totals.discountMinor, false],
    [QUOTE.tax, doc.totals.taxMinor, false],
    [QUOTE.total, doc.totals.totalMinor, true],
  ]
  for (const [label, value, grand] of totals) {
    ws.mergeCells(`E${r}:F${r}`)
    const l = ws.getCell(`E${r}`)
    l.value = label
    l.alignment = { horizontal: 'right' }
    l.font = { size: grand ? 12 : 10, bold: grand }

    const v = ws.getCell(`${LAST_COL}${r}`)
    v.value = money(value, cur)
    v.numFmt = fmt
    v.alignment = { horizontal: 'right' }
    v.font = { size: grand ? 12 : 10, bold: grand }
    if (grand) {
      v.border = { top: { style: 'medium', color: { argb: 'FF111827' } } }
      l.border = { top: { style: 'medium', color: { argb: 'FF111827' } } }
    }
    r += 1
  }

  if (doc.totals.totalInWords) {
    ws.mergeCells(`E${r}:${LAST_COL}${r}`)
    const w = ws.getCell(`E${r}`)
    w.value = doc.totals.totalInWords
    w.alignment = { horizontal: 'right' }
    w.font = { size: 10, color: { argb: MUTED } }
    r += 1
  }
  r += 1

  // ── 조건·특기사항 ───────────────────────────────────────
  const section = (label: string, lines: string[]) => {
    if (lines.length === 0) return
    ws.getCell(`A${r}`).value = label
    ws.getCell(`A${r}`).font = { size: 9, bold: true, color: { argb: MUTED } }
    r += 1
    for (const t of lines) {
      ws.mergeCells(`A${r}:${LAST_COL}${r}`)
      const c = ws.getCell(`A${r}`)
      c.value = t
      c.font = { size: 10 }
      c.alignment = { wrapText: true, vertical: 'top' }
      r += 1
    }
    r += 1
  }
  section(QUOTE.terms, doc.terms)
  section(QUOTE.customerNote, doc.customerNote ? doc.customerNote.split('\n') : [])

  // 인쇄 영역을 명시한다 — 안 하면 빈 열까지 잡아 종이가 한 장 더 나온다
  // **실제로 쓴 마지막 행까지만.** r 은 다음에 쓸 자리라 그대로 쓰면 빈 행이 딸려 오고,
  // 그게 쪽 경계에 걸리면 백지 한 장이 더 나온다
  ws.pageSetup.printArea = `A1:${LAST_COL}${Math.max(1, ws.rowCount)}`
  // 항목이 여러 장으로 넘어가면 표 머리글을 매 장에 다시 찍는다
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`
  // **덮어쓰지 않는다.** 앞에서 끈 눈금선을 여기서 `ws.views = [...]` 로 갈아치우면
  // 격자가 되살아난다(실측: 사용자가 받은 파일에 격자가 그대로 있었다).
  if (lastLineRow >= headRow) {
    ws.views = [{ showGridLines: false, state: 'frozen', ySplit: headRow }]
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { filename: `${doc.meta.quoteNo}_${QUOTE.documentTitle}.xlsx`, buffer }
}
