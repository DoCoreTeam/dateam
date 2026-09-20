/**
 * 엑셀 원본을 **표로 펴서** 대조 화면에 세운다
 *
 * ## 왜 필요한가
 *
 * 견적서는 엑셀로 오는 일이 흔하다. 그런데 브라우저는 엑셀을 못 그리고, 그동안 대조 화면은
 * 「이 형식은 화면 안에 못 그려요」로 끝났다 — 대조하러 연 화면이 대조를 못 하는 상태다.
 * PDF 처럼 쪽을 오릴 수도 없다. 엑셀에는 쪽이라는 것이 아예 없기 때문이다.
 *
 * ## 우리가 읽은 결과가 아니라 «원본»을 그린다
 *
 * 읽은 결과를 왼쪽에 세우면 그건 대조가 아니다 — 우리 해석과 우리 해석을 견주는 셈이다.
 * 그래서 첨부된 **그 파일의 셀**을 그대로 편다.
 *
 * ## 글자로만 그린다
 *
 * 셀 값은 남이 만든 문서에서 온 값이다. HTML 로 조립하면 그 안의 것이 우리 화면에서 돈다.
 * 여기서는 **문자열만** 돌려주고, 화면은 그것을 글자 노드로 넣는다(S4).
 */

/** 한 번에 그릴 줄 수 상한. 넘으면 잘랐다고 말한다 */
export const MAX_SHEET_ROWS = 300

/** 한 줄에 그릴 칸 수 상한 */
export const MAX_SHEET_COLS = 20

export interface SheetPreview {
  /** 시트 이름 */
  name: string
  /** 행마다 칸 값(글자). 빈 칸은 빈 문자열 */
  rows: string[][]
  /** 상한에 걸려 자른 줄 수. 0 이 아니면 화면이 그 수를 말한다 */
  droppedRows: number
}

/** 값을 글자로. 숫자·날짜도 사람이 읽는 모양 그대로 */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/**
 * 엑셀·CSV 바이트를 표로 편다. **브라우저에서만 돈다.**
 *
 * 못 읽으면 `null` — 부르는 쪽은 그때 예전 안내로 물러선다.
 * 읽는 도구는 **이 함수 안에서만** 불러온다. 위에서 물면 견적 화면을 열기만 해도
 * 그 무게를 같이 지고, 대조를 안 여는 사람까지 값을 치른다.
 */
export async function readSheetPreview(bytes: ArrayBuffer): Promise<SheetPreview[] | null> {
  try {
    const XLSX = await import('xlsx')
    const book = XLSX.read(new Uint8Array(bytes), { type: 'array', cellDates: true })
    const out: SheetPreview[] = []
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name]
      if (!sheet) continue
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
      const rows = raw
        .map((row) => (Array.isArray(row) ? row.slice(0, MAX_SHEET_COLS).map(cellText) : []))
        // 통째로 빈 줄은 버린다 — 엑셀은 빈 줄을 수백 개 들고 있는 일이 흔하다
        .filter((row) => row.some((c) => c.trim().length > 0))
      out.push({
        name,
        rows: rows.slice(0, MAX_SHEET_ROWS),
        droppedRows: Math.max(0, rows.length - MAX_SHEET_ROWS),
      })
    }
    // 내용이 하나도 없으면 «그렸다»고 하지 않는다 — 빈 표는 안내문보다 나쁘다
    return out.some((s) => s.rows.length > 0) ? out : null
  } catch {
    return null
  }
}
