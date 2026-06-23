// 전사 우선(Transcription-first) SSOT — 추출 전, 입력 가격표를 "본 그대로" 옮긴다.
// 왜: OCR+정규화+카탈로그매핑+스키마를 한 호출에 시키면 행이 조용히 누락된다(Nebius 9행 중 4행 손실).
//   전사는 "읽기만" 시켜 인지부하·카탈로그 편향을 제거 → 누락 급감 + source_row_count 확보(행수 대조의 기준).
// 정책: 카탈로그/스펙 컨텍스트 주입 금지(편향 제거). 매핑·환산·해석·생략 일절 지시하지 않는다.

// 전사 1행 — 입력 표의 보이는 한 행에 정확히 한 객체로 대응.
export interface TranscriptionRow {
  /** 행의 모델/항목 라벨(예: "HGX B300", "GB200") — 본 그대로 */
  raw_label: string
  /** 행의 셀 값들 — 본 그대로(빈칸 포함 가능) */
  cells: string[]
  /** 가격 텍스트 그대로(없으면 null — "Contact us"/"—"/"문의"는 빈가격으로 null) */
  price_text: string | null
}

export interface TranscriptionResult {
  rows: TranscriptionRow[]
  /** AI가 센 원본 행 수 — 행수 대조(reconcile)의 기준값 */
  source_row_count: number
}

// 전사 프롬프트 — "모든 행 verbatim, 매핑/환산/해석/생략 금지, 가격없는 행 포함".
// 카탈로그·스키마 미주입(편향 제거). 출력은 엄격 JSON.
export function buildTranscriptionPrompt(): string {
  return [
    '당신은 가격표 전사기입니다. 입력(이미지/표/텍스트)에 보이는 모든 가격표 행을 본 그대로(verbatim) 옮기세요.',
    '',
    '【절대 규칙】',
    '- 매핑·환산·해석·정규화·생략을 절대 하지 마세요. 표준 모델명으로 바꾸지 마세요. 단위를 바꾸지 마세요.',
    '- 표에 보이는 한 행당 정확히 한 객체. 행을 합치거나 나누지 마세요.',
    '- 가격이 없는 행("Contact us", "문의", "—", "-", 빈칸)도 반드시 포함하세요(누락 금지). 그 행의 price_text는 null.',
    '- 보이는 글자 그대로 기록하세요. 추측·보완·환각 금지. 빈칸은 빈 문자열로.',
    '',
    '【출력 — JSON만, 코드펜스·설명 없이】',
    '{"rows":[{"raw_label":"행의 모델/항목 라벨","cells":["셀1","셀2"],"price_text":"가격 텍스트 또는 null"}],"source_row_count": 표에서_본_가격표_행_수}',
    'source_row_count는 rows 길이와 같아야 하며, 표에서 실제로 본 가격표 행의 총 수입니다.',
  ].join('\n')
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// 전사 응답 파서 — 안전 파싱. 실패 시 빈 결과({rows:[], source_row_count:0}).
// 입력은 신뢰 불가(AI 출력) → 모든 필드 방어적 정규화. JSON 외 잡텍스트(코드펜스 등)도 관용 처리.
export function parseTranscription(text: unknown): TranscriptionResult {
  const empty: TranscriptionResult = { rows: [], source_row_count: 0 }
  if (typeof text !== 'string' || text.trim().length === 0) return empty

  // 코드펜스/앞뒤 잡텍스트 관용: 첫 '{' ~ 마지막 '}' 슬라이스로 JSON 본문 추출
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return empty
    try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return empty }
  }

  if (!raw || typeof raw !== 'object') return empty
  const obj = raw as Record<string, unknown>
  const rawRows = Array.isArray(obj.rows) ? obj.rows : []

  const rows: TranscriptionRow[] = []
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') continue
    const ro = r as Record<string, unknown>
    const raw_label = asString(ro.raw_label).trim()
    const cells = Array.isArray(ro.cells) ? ro.cells.map(asString) : []
    const pt = ro.price_text
    const price_text = typeof pt === 'string' && pt.trim().length > 0 ? pt.trim() : null
    // 라벨도 셀도 전혀 없는 완전 빈 행은 스킵(노이즈) — 가격없는 행은 라벨이 있으므로 보존됨
    if (!raw_label && cells.every((c) => c.trim() === '')) continue
    rows.push({ raw_label, cells, price_text })
  }

  // source_row_count: AI 값 우선(유효 양수일 때), 아니면 파싱된 rows 길이로 폴백.
  const declared = typeof obj.source_row_count === 'number' && Number.isFinite(obj.source_row_count)
    ? Math.max(0, Math.floor(obj.source_row_count))
    : null
  const source_row_count = declared !== null ? Math.max(declared, rows.length) : rows.length

  return { rows, source_row_count }
}
