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

import { exportFileName, type QuoteDocument } from '../domain/quote-document.ts'
import { QUOTE, SUPPLIER_ORDER, SUPPLIER_LABEL } from '../../terms/quote.ts'
import { minorDigits, currencyAffix } from '../../../app/(crm)/crm/deals/amount.ts'

/** 항목 표의 열 — 화면(§견적서)과 **같은 순서**다. 다르면 같은 문서가 아니다 */
const COLUMNS = [
  { key: 'no', label: QUOTE.lineNo, width: 5 },
  { key: 'name', label: QUOTE.lineName, width: 34 },
  { key: 'unit', label: QUOTE.lineUnit, width: 7 },
  { key: 'qty', label: QUOTE.lineQuantity, width: 8 },
  { key: 'price', label: QUOTE.lineUnitPrice, width: 18 },
  { key: 'disc', label: QUOTE.lineDiscount, width: 9 },
  { key: 'amount', label: QUOTE.lineAmount, width: 21 },
] as const

/** 공급자 값이 들어가는 병합 폭(F+G) — 행 높이를 이 폭으로 계산해야 주소가 안 잘린다 */
const SUPPLIER_VALUE_WIDTH = COLUMNS[5].width + COLUMNS[6].width

/**
 * 문서 글꼴 — **화면과 같은 것을 쓴다.**
 * 엑셀 기본(맑은 고딕)으로 나가면 같은 문서인데 웹과 인상이 다르다
 * (사용자 지시: 「폰트는 pretendard 통일」).
 */
const FONT = 'Pretendard'

const LAST_COL = 'G'          // COLUMNS 의 마지막 열
const HAIRLINE = 'FFD8DCE3'   // 표 테두리
const HEAD_BG = 'FFF2F4F7'    // 표 머리글 배경
const MUTED = 'FF6B7280'      // 보조 글자
const SPECIAL = 'FFDC2626'    // 특별 할인 — 화면의 var(--danger) 와 같은 자리

/**
 * 할인율 → 곱할 배율. `100%` 면 0, `0%` 면 1.
 *
 * 범위를 0~100 으로 조인다 — 잘못된 값이 수식에 들어가면 **엑셀에서 음수 금액**이 나온다.
 */
function discountFactor(pct: string): number {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 1
  const clamped = Math.min(100, Math.max(0, n))
  return Number((1 - clamped / 100).toFixed(6))
}

/**
 * 할인 칸에 들어갈 글자.
 *
 * 특별 할인이 있으면 **가는 길을 그대로** 적는다 — 화면의 「30% → 80%」와 같은 말이다.
 * 엑셀 셀 안에서는 색을 부분만 다르게 줄 수 없으므로(리치텍스트가 필요하다)
 * 뜻은 글자로 밝힌다. 강조는 아래 `특별` 표시가 맡는다.
 */
function discountCellText(line: {
  discountPercent: string
  isSpecialDiscount?: boolean
  baseDiscountPercent?: string
  specialDiscountPercent?: string
}): string {
  if (line.isSpecialDiscount) {
    const base = line.baseDiscountPercent && line.baseDiscountPercent !== '0'
      ? `${line.baseDiscountPercent}% → ` : ''
    return `${base}특별 ${line.specialDiscountPercent}%`
  }
  return line.discountPercent === '0' ? '' : `${line.discountPercent}%`
}

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

/**
 * PNG·JPEG 의 **원본 크기**를 헤더에서 읽는다.
 *
 * **왜 필요한가**: 로고 크기를 `150×36` 으로 고정하면 원본 비율과 다를 때 눌리거나 늘어난다
 * (사용자 지적: 「로고는 모양 그대로 내보내 크기 일부러 만져서 문제 일으키지 말고」).
 * 폭만 맞추고 높이는 **원본 비율로** 계산하면 모양이 그대로 남는다.
 */
function imageSize(base64: string, ext: 'png' | 'jpeg'): { w: number; h: number } | null {
  try {
    const buf = Buffer.from(base64, 'base64')
    if (ext === 'png') {
      // 8바이트 시그니처 + 길이(4) + 'IHDR'(4) → 폭·높이가 각 4바이트 big-endian
      if (buf.length < 24) return null
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      // C0~CF 중 C4(DHT)·C8·CC 는 SOF 가 아니다
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return null
  } catch {
    return null
  }
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

  /*
    ── 머리 — 로고(좌) ↔ 견적번호·견적일·유효기간(우) ──────────────
    **화면과 같은 자리에 둔다.** 예전엔 로고만 위에 두고 메타 셋을 표 바로 위(13행)에
    가로로 늘어놓아서, 같은 문서인데 웹과 엑셀이 다르게 보였다
    (사용자 지적: 「견적번호, 견적일, 유효기간 배치가 상이하다」).

    로고는 **행 높이를 먼저 키운 뒤** 앉힌다 — 안 그러면 아래 내용을 덮는다.
    비율도 지킨다(150×36). 예전엔 48 로 늘려 로고가 눌려 보였다
    (「로고가 정상적으로 보여지지 않는다」).
  */
  // 상단 합계 띠가 참조할 자리 — 아래 합계 행이 정해진 뒤 채운다
  let bandTotalCell = ''
  let bandWordsCell = ''

  const headTop = r
  const logo = parseImage(input.logo ?? '')
  // 폭만 맞추고 높이는 **원본 비율**로 — 둘 다 고정하면 로고가 눌린다
  const LOGO_W = 150
  const size = logo ? imageSize(logo.base64, logo.extension) : null
  const logoH = size && size.w > 0 ? Math.round((LOGO_W * size.h) / size.w) : 36
  // 로고가 아래를 덮지 않게 행 높이를 먼저 키운다(행 높이는 pt, 이미지는 px)
  ws.getRow(r).height = Math.max(30, logoH * 0.78 + 6)
  if (logo) {
    const id = wb.addImage(logo)
    ws.addImage(id, { tl: { col: 0.2, row: r - 1 + 0.1 }, ext: { width: LOGO_W, height: logoH } })
  }

  // 오른쪽 — 라벨(F) / 값(G). 화면의 우상단 메타와 같은 순서·같은 정렬이다
  const headMeta: [string, string][] = ([
    [QUOTE.quoteNo, doc.meta.quoteNo],
    [QUOTE.issuedOn, doc.meta.issuedOn ?? ''],
    [QUOTE.validUntil, doc.meta.validUntil ?? ''],
  ] as [string, string][]).filter(([, v]) => v !== '')

  /*
    날짜는 **날짜 값**으로 넣는다(문자열이 아니라). 그래야 받은 사람이 정렬·계산할 수 있고,
    **유효기간은 견적일을 참조하는 수식**이 된다 — 견적일을 고치면 유효기간이 따라 움직인다
    (사용자 지시: 「견적일, 견적유효기간도 수식으로」).
  */
  const issuedRow = headTop + headMeta.findIndex(([l]) => l === QUOTE.issuedOn)
  const validDays = doc.meta.issuedOn && doc.meta.validUntil
    ? Math.round(
      (Date.parse(`${doc.meta.validUntil}T00:00:00Z`) - Date.parse(`${doc.meta.issuedOn}T00:00:00Z`)) / 86_400_000,
    )
    : null

  headMeta.forEach(([label, value], i) => {
    const row = headTop + i
    if (i > 0) ws.getRow(row).height = 16
    const l = ws.getCell(`F${row}`)
    l.value = label
    l.font = { size: 9, color: { argb: MUTED } }
    l.alignment = { horizontal: 'right', vertical: 'middle' }

    const v = ws.getCell(`${LAST_COL}${row}`)
    if (label === QUOTE.issuedOn) {
      v.value = new Date(`${value}T00:00:00Z`)
      v.numFmt = 'yyyy-mm-dd'
    } else if (label === QUOTE.validUntil && validDays !== null && issuedRow >= headTop) {
      v.value = { formula: `${LAST_COL}${issuedRow}+${validDays}` }
      v.numFmt = 'yyyy-mm-dd'
    } else {
      v.value = value
    }
    v.font = { size: 10, bold: true }
    v.alignment = { horizontal: 'right', vertical: 'middle' }
  })
  r = headTop + Math.max(1, headMeta.length) + 1

  // ── 제목 ────────────────────────────────────────────────
  ws.mergeCells(`A${r}:${LAST_COL}${r}`)
  const title = ws.getCell(`A${r}`)
  // 엑셀에는 자간(letter-spacing)이 없다 — 화면의 「견 적 서」와 같아 보이게 공백을 넣는다
  title.value = Array.from(QUOTE.documentTitle).join(' ')
  title.font = { size: 22, bold: true }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(r).height = 42
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
    ws.getCell(`E${row}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    ws.mergeCells(`F${row}:${LAST_COL}${row}`)
    ws.getCell(`F${row}`).value = doc.supplier[f]
    ws.getCell(`F${row}`).font = { size: 10 }
    ws.getCell(`F${row}`).alignment = { wrapText: true, vertical: 'top' }
  })

  // 담당 — 이 견적을 만든 사람. 화면에 있는 것이 파일에도 있어야 한다
  if (doc.owner.name) {
    const row = partyTop + 1 + filled.length
    ws.getCell(`E${row}`).value = QUOTE.supplierContact
    ws.getCell(`E${row}`).font = { size: 9, color: { argb: MUTED } }
    ws.mergeCells(`F${row}:${LAST_COL}${row}`)
    const who = `${doc.owner.name}${doc.owner.title ? ` ${doc.owner.title}` : ''}`
    const how = [doc.owner.phone, doc.owner.email].filter(Boolean).join(' · ')
    ws.getCell(`F${row}`).value = how ? `${who} · ${how}` : who
    ws.getCell(`F${row}`).font = { size: 10 }
    ws.getCell(`F${row}`).alignment = { wrapText: true, vertical: 'top' }
  }

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
  const ownerRows = doc.owner.name ? 1 : 0
  const partyBottom = Math.max(r + customerRowsData.length, partyTop + filled.length + ownerRows)

  // 긴 값(주소·종목·담당)은 한 줄에 안 들어간다 — 행 높이를 안 키우면 **잘려서 인쇄된다**
  for (let row = partyTop; row <= partyBottom; row += 1) {
    const texts = [String(ws.getCell(`B${row}`).value ?? ''), String(ws.getCell(`F${row}`).value ?? '')]
    /*
      **왼쪽과 오른쪽의 병합 폭이 다르다.** 예전엔 둘 다 B+C 폭으로 쟀는데,
      공급자 값은 F+G 에 들어가므로 **주소처럼 긴 값이 잘린 채 인쇄됐다**
      (사용자 지적: 「주소 부분에 셀폭이 안맞는건지 주소가 짤린다」).
    */
    const leftW = COLUMNS[1].width + COLUMNS[2].width
    const need = Math.max(
      wrapHeight(texts[0], leftW),
      wrapHeight(texts[1], SUPPLIER_VALUE_WIDTH),
    )
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

  /*
    ── 합계 띠 ─────────────────────────────────────────────
    금액이 **표 위에 한 번 더** 온다. 받은 사람이 가장 먼저 찾는 것이 「얼마인가」인데
    항목표를 다 지나야 나오면 매번 스크롤해서 찾는다 — 화면도 같은 자리에 있다
    (사용자 지적: 「샘플 견적서 처럼 상단에 공급금액이 숫자와 한글로 표기되지 않는다」).
  */
  {
    ws.mergeCells(`A${r}:B${r}`)
    const l = ws.getCell(`A${r}`)
    l.value = QUOTE.total
    l.font = { size: 11, bold: true, color: { argb: MUTED } }
    l.alignment = { horizontal: 'left', vertical: 'middle' }

    ws.mergeCells(`C${r}:E${r}`)
    const w = ws.getCell(`C${r}`)
    w.font = { size: 11, bold: true }
    w.alignment = { horizontal: 'left', vertical: 'middle' }
    bandWordsCell = `C${r}`

    ws.mergeCells(`F${r}:${LAST_COL}${r}`)
    const v = ws.getCell(`F${r}`)
    /*
      **아래 합계를 참조한다.** 같은 금액을 두 번 적으면 항목을 고쳤을 때 위아래가 달라지고,
      어느 쪽이 맞는지 받은 사람이 판단해야 한다(사용자 지시: 「G16의 금액도 수식」).
      합계 행 번호는 뒤에서 정해지므로 자리만 잡아 두고 마지막에 채운다.
    */
    v.numFmt = fmt
    bandTotalCell = `F${r}`
    v.font = { size: 14, bold: true }
    v.font = { size: 14, bold: true }
    v.alignment = { horizontal: 'right', vertical: 'middle' }

    const heavy = { style: 'medium' as const, color: { argb: 'FF111827' } }
    for (let col = 1; col <= 7; col += 1) {
      const cell = ws.getCell(r, col)
      cell.border = {
        top: heavy, bottom: heavy,
        left: col === 1 ? heavy : undefined,
        right: col === 7 ? heavy : undefined,
      }
    }
    ws.getRow(r).height = 26
    r += 2
  }

  // ── 항목 표 ─────────────────────────────────────────────
  const headRow = r
  COLUMNS.forEach((c, i) => {
    const cell = ws.getCell(headRow, i + 1)
    cell.value = c.label
    cell.font = { size: 10, bold: true, color: { argb: MUTED } }
    /*
      **머리글은 전부 가운데다**(사용자 지시: 「제목만 중앙정렬로」).
      값은 각자의 정렬을 지킨다 — 금액을 가운데로 두면 자릿수가 세로로 안 맞는다.
      화면(QuoteSheet)과 같은 규칙이라 두 문서가 같아 보인다.
    */
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_BG } }
    cell.border = border
  })
  ws.getRow(headRow).height = 24
  r += 1

  const firstLineRow = r

  for (const line of doc.lines) {
    // 규격은 품목 아래 줄바꿈으로 붙인다 — 별도 열을 만들면 표가 가로로 넘친다
    const name = line.spec ? `${line.name}\n${line.spec}` : line.name
    const values: (string | number | { formula: string })[] = [
      line.no,
      name,
      line.unit ?? '',
      Number(line.quantity),
      money(line.unitPriceMinor, cur),
      /*
        **할인 칸은 두 비율을 함께 말한다** — 「30% → 80%」.
        실효율(86%)만 적으면 고객은 어디서 얼마나 깎였는지 모르고,
        기본 할인만 적으면 금액과 어긋난다(화면에서 그 사고가 났다).
      */
      discountCellText(line),
      /*
        **금액은 수식이다.** 값만 넣으면 받은 사람이 수량이나 단가를 고쳤을 때
        금액이 그대로 남아 «틀린 견적서»가 된다. 수식이면 그 자리에서 다시 계산된다
        (사용자 지시: 「수식으로 구성되었으면 한다」).
        할인은 퍼센트 문자열이라 셀에서 못 쓴다 — 배율을 우리가 계산해 곱한다.
      */
      { formula: `ROUND(D${r}*E${r}*${discountFactor(line.discountPercent)},0)` },
      // ↑ 배율은 **실효 할인율**로 낸다 — 기본과 특별이 겹친 결과가 이미 그 값이다
    ]
    values.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v
      cell.border = border
      // 특별가 줄의 할인 칸(F)은 굵은 빨강 — 화면에서 크게 강조한 그 자리다
      cell.font = (i === 5 && line.isSpecialDiscount)
        ? { size: 10, bold: true, color: { argb: SPECIAL } }
        : { size: 10 }
      // 세로는 전부 가운데(마지막 손질이 한 번 더 보장한다), 양끝은 한 칸 들인다
      if (i === 1) cell.alignment = { wrapText: true, vertical: 'middle', indent: 1 }
      else if (i >= 3) cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
      else cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (i === 4 || i === 6) cell.numFmt = fmt
    })
    // 품목+규격이 두 줄이라 높이를 준다. 긴 품목명은 더 필요할 수 있다
    // 화면의 행 여백에 맞춘다 — 빽빽하면 표가 아니라 격자로 읽힌다
    ws.getRow(r).height = Math.max(line.spec ? 34 : 22, wrapHeight(name, COLUMNS[1].width, 16))
    r += 1
  }
  const lastLineRow = r - 1
  r += 1

  // ── 합계 ────────────────────────────────────────────────
  /*
    합계도 **수식**이다. 항목을 고치면 아래가 따라 움직인다.
    다만 «공급가액»만 SUM 이고 할인·부가세·합계는 우리가 계산한 값을 쓴다 —
    할인은 항목별 비율이라 한 줄로 못 쓰고, 부가세는 세율 구분(과세·영세·면세)이
    항목마다 다를 수 있어 표에 없는 정보가 필요하다. 지어낸 수식보다 **맞는 값**이 낫다.
  */
  const has = firstLineRow <= lastLineRow
  const D = `D${firstLineRow}:D${lastLineRow}`
  const E = `E${firstLineRow}:E${lastLineRow}`
  const G = `${LAST_COL}${firstLineRow}:${LAST_COL}${lastLineRow}`

  /*
    **공급가액은 «할인 전»이다.**
    표의 「금액」 열은 할인이 이미 빠진 값이라 그것을 더하면 화면과 달라진다 —
    실제로 엑셀이 300,000,000, 화면이 350,000,000 이었다(같은 문서가 두 숫자를 말한 것).
    그래서 «수량 × 단가»의 합으로 낸다.

    **할인은 그 차이다.** 항목마다 할인율이 달라 한 줄로 못 쓰지만, 뺄셈이면 정확하다.
    **부가세와 합계도 수식**이라 항목을 고치면 아래가 전부 따라 움직인다
    (사용자 지시: 「G23,24,25,26,27 모두 수식으로 처리 할 수 있도록」).
  */
  const subtotalRow = r
  const discountRow = r + 1
  const taxRow = r + 2
  const grandRow = r + 3

  const subtotalF = has ? `SUMPRODUCT(${D},${E})` : null
  const discountF = has ? `${LAST_COL}${subtotalRow}-SUM(${G})` : null
  /*
    부가세는 **지금 값에서 역산한 세율**로 건다. 항목마다 과세·영세·면세가 섞일 수 있어
    10%를 박으면 틀린 문서가 나온다 — 우리가 이미 정확히 계산한 값의 비율을 쓴다.
  */
  const taxRate = Number(doc.totals.subtotalMinor) - Number(doc.totals.discountMinor) > 0
    ? Number(doc.totals.taxMinor) / (Number(doc.totals.subtotalMinor) - Number(doc.totals.discountMinor))
    : 0
  const taxF = has
    ? `ROUND((${LAST_COL}${subtotalRow}-${LAST_COL}${discountRow})*${taxRate.toFixed(6)},0)`
    : null
  const grandF = has
    ? `${LAST_COL}${subtotalRow}-${LAST_COL}${discountRow}+${LAST_COL}${taxRow}`
    : null

  const totals: [string, string, boolean, string | null][] = [
    [QUOTE.subtotal, doc.totals.subtotalMinor, false, subtotalF],
    [QUOTE.discount, doc.totals.discountMinor, false, discountF],
    [QUOTE.tax, doc.totals.taxMinor, false, taxF],
    [QUOTE.total, doc.totals.totalMinor, true, grandF],
  ]
  for (const [label, value, grand, formula] of totals) {
    /*
      **라벨은 D:F 세 칸에 걸친다.** 화면에서도 합계 라벨이 오른쪽 세 열을 가로질러
      금액 바로 앞에 붙는다 — 두 칸이면 「합계 금액」이 좁아 보이고 금액과의 간격이 벌어진다
      (사용자 지시: 「합계금액은 병합을 통해서 현재 웹스타일 유지」).
    */
    ws.mergeCells(`D${r}:F${r}`)
    const l = ws.getCell(`D${r}`)
    l.value = label
    l.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 }
    l.font = { size: grand ? 13 : 10, bold: grand, color: { argb: grand ? 'FF111827' : MUTED } }

    const v = ws.getCell(`${LAST_COL}${r}`)
    v.value = formula ? { formula } : money(value, cur)
    v.numFmt = fmt
    v.alignment = { horizontal: 'right', vertical: 'middle' }
    v.font = { size: grand ? 14 : 10, bold: grand }
    if (grand) {
      // 합계 위의 굵은 선 — 화면의 `border-top: var(--border-w) solid var(--text)` 와 같은 자리
      const top = { style: 'medium' as const, color: { argb: 'FF111827' } }
      for (const col of ['D', 'E', 'F', LAST_COL]) ws.getCell(`${col}${r}`).border = { top }
      ws.getRow(r).height = 24
    } else {
      ws.getRow(r).height = 18
    }
    r += 1
  }

  if (doc.totals.totalInWords) {
    ws.mergeCells(`D${r}:${LAST_COL}${r}`)
    const w = ws.getCell(`D${r}`)
    /*
      **한글 금액도 합계를 참조한다.**
      `NUMBERSTRING` 은 한국어 엑셀의 함수라 다른 환경에서는 `#NAME?` 이 뜬다 —
      그래서 `IFERROR` 로 감싸고, 안 되는 환경에서는 우리가 계산한 문자열이 그대로 나온다.
      되는 환경에서는 항목을 고치면 한글 금액도 함께 바뀐다(사용자 지시).
    */
    w.value = grandF
      ? { formula: `IFERROR("금 "&NUMBERSTRING(${LAST_COL}${grandRow},1)&"원정","${doc.totals.totalInWords}")` }
      : doc.totals.totalInWords
    w.alignment = { horizontal: 'right', vertical: 'middle' }
    // 자간을 넓혀 화면의 `letter-spacing: 0.05em` 에 가깝게 — 엑셀엔 자간이 없어 공백으로 흉내 낸다
    w.font = { size: 10, color: { argb: MUTED } }
    ws.getRow(r).height = 18
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

  /*
    ── 마지막 손질 — 서식을 **한 곳에서** 통일한다 ──────────────────
    셀마다 폰트·세로정렬을 적으면 반드시 빠뜨리는 곳이 생기고, 그 셀만 다르게 보인다
    (사용자 지적: 「엑셀에서 글자 세로 정렬이 아래로 있고 위로 있고 하던데
     그냥 중앙정렬로 통일시켜 … 폰트는 pretendard 통일」).
    그래서 **각 셀에 쓰지 않고 마지막에 한 번 훑는다** — 빠질 수가 없다.
  */
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      // 크기·굵기·색은 그대로 두고 **글꼴 이름만** 채운다
      cell.font = { ...(cell.font ?? {}), name: FONT }
      // 세로는 전부 가운데. 가로 정렬과 줄바꿈은 각 셀이 정한 것을 지킨다
      cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle' }
    })
  })

  /*
    **상단 합계 띠를 아래 합계에 묶는다.**
    같은 금액을 두 번 적으면 항목을 고쳤을 때 위아래가 달라진다 — 어느 쪽이 맞는지
    받은 사람이 판단해야 하는 문서는 문서가 아니다.
  */
  if (bandTotalCell && grandF) {
    ws.getCell(bandTotalCell).value = { formula: `${LAST_COL}${grandRow}` }
  } else if (bandTotalCell) {
    ws.getCell(bandTotalCell).value = money(doc.totals.totalMinor, cur)
  }
  if (bandWordsCell) {
    ws.getCell(bandWordsCell).value = grandF
      ? { formula: `IFERROR("금 "&NUMBERSTRING(${LAST_COL}${grandRow},1)&"원정","${doc.totals.totalInWords}")` }
      : doc.totals.totalInWords
  }

  const lastUsedRow = Math.max(1, ws.rowCount)

  /*
    ── 문서 밖은 «없는 것»으로 만든다 ──────────────────────────
    받은 사람이 파일을 열면 오른쪽으로 H·I·J… 가 끝없이 이어지고 아래로도 그렇다.
    그러면 이건 **문서가 아니라 스프레드시트**로 읽힌다
    (사용자 지시: 「엑셀에는 견적내용만큼만 영역이 지정되고 나머지는 비활성화 되었으면 한다」).

    숨김(hidden)으로 처리한다 — 지울 수는 없고, 숨기면 화면에서도 인쇄에서도 사라진다.
    필요하면 받은 사람이 되살릴 수 있다(잠그는 것과 다르다).
  */
  const LAST_HIDDEN_COL = 40   // H(8) ~ AN(40) — 화면 한 판을 덮기에 충분하다
  for (let col = COLUMNS.length + 1; col <= LAST_HIDDEN_COL; col += 1) {
    ws.getColumn(col).hidden = true
  }
  const LAST_HIDDEN_ROW = lastUsedRow + 60
  for (let row = lastUsedRow + 1; row <= LAST_HIDDEN_ROW; row += 1) {
    ws.getRow(row).hidden = true
  }

  /*
    **시트를 보호한다 — 다만 잠그지는 않는다.**
    수식이 든 금액 칸을 실수로 덮어쓰면 견적서가 조용히 틀어진다. 그렇다고 전체를 잠그면
    받은 사람이 수량을 바꿔 볼 수 없다 — 그건 수식을 넣은 이유를 없애는 일이다.
    그래서 «보호»는 걸지 않고, 대신 아래 커서 위치만 문서 첫 칸으로 되돌린다.
  */
  ws.views = ws.views ?? []

  // 인쇄 영역을 명시한다 — 안 하면 빈 열까지 잡아 종이가 한 장 더 나온다
  // **실제로 쓴 마지막 행까지만.** r 은 다음에 쓸 자리라 그대로 쓰면 빈 행이 딸려 오고,
  // 그게 쪽 경계에 걸리면 백지 한 장이 더 나온다
  ws.pageSetup.printArea = `A1:${LAST_COL}${lastUsedRow}`
  // 항목이 여러 장으로 넘어가면 표 머리글을 매 장에 다시 찍는다
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`
  /*
    **눈금선은 꺼진 채로 둔다.** 여기서 `ws.views` 를 갈아치우면 앞에서 끈 격자가 되살아난다
    (실측: 사용자가 받은 파일에 격자가 그대로 있었다).
    항목이 여러 장으로 넘어갈 때만 머리글을 고정한다.
  */
  ws.views = lastLineRow >= headRow
    ? [{ showGridLines: false, state: 'frozen', ySplit: headRow, topLeftCell: `A${headRow + 1}` }]
    : [{ showGridLines: false }]

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  // 파일명은 **한 규칙**이다 — 엑셀·PDF·이미지가 같은 함수를 쓴다
  return { filename: exportFileName(doc, QUOTE.documentTitle, 'xlsx'), buffer }
}
