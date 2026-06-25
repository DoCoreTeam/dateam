// 회의노트 추출 결과 매핑 + 필터링 순수 헬퍼 (Supabase/Gemini 비의존)
// gemini-meeting.ts의 모듈-프라이빗 로직을 테스트 가능하도록 분리.
// 출처: apps/web/lib/gemini-meeting.ts (mapTasks/mapEvents/mapHighlights 동일 로직 SSOT)
// datetime 규약: toStartAt 은 lib/datetime/kst.ts 와 동일한 +09:00 앵커를 사용한다.
//   (이 파일은 의존성 없는 순수 헬퍼 — node 단위테스트 직접 실행 위해 import 미추가. 가드가 lib/meeting 스캔으로 naive 회귀 차단.)

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^\d{2}:\d{2}$/

// ---- raw JSON → typed record ----
export function asRecord(item: unknown): Record<string, unknown> {
  return (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
}

export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function numConfidence(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

// ---- JSON 파싱 (마크다운 코드펜스 제거 포함) ----
export function parseJsonSafe(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return JSON.parse(stripped)
}

// ---- 추출 후보 타입 ----
export interface TaskCandidate {
  title: string
  confidence: number
  source_quote: string | null
}

export interface EventCandidate {
  title: string
  confidence: number
  source_quote: string | null
  suggested_date: string | null
  suggested_time: string | null
}

export interface HighlightCandidate {
  title: string
  confidence: number
  source_quote: string | null
}

export type AttendeeAffiliation = 'internal' | 'external' | 'unknown'

export interface AttendeeCandidate {
  name: string
  confidence: number
  source_quote: string | null
  // AI가 판단한 소속. 'external'이면 동명이인 조직원과 자동매칭하지 않는다(이름충돌 오매칭 방지).
  affiliation: AttendeeAffiliation
}

// ---- 필터 기준: title 비어있음 / source_quote null / confidence < 0.7 제외 ----
export function mapTasks(raw: unknown): TaskCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const r = asRecord(item)
      return {
        title: typeof r.title === 'string' ? r.title.trim() : '',
        confidence: numConfidence(r.confidence),
        source_quote: strOrNull(r.source_quote),
      }
    })
    .filter((c) => c.title !== '' && c.source_quote !== null && c.confidence >= 0.7)
}

export function mapEvents(raw: unknown): EventCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const r = asRecord(item)
      const date = strOrNull(r.suggested_date)
      const time = strOrNull(r.suggested_time)
      return {
        title: typeof r.title === 'string' ? r.title.trim() : '',
        confidence: numConfidence(r.confidence),
        source_quote: strOrNull(r.source_quote),
        suggested_date: date && DATE_RE.test(date) ? date : null,
        suggested_time: time && TIME_RE.test(time) ? time : null,
      }
    })
    .filter((c) => c.title !== '' && c.source_quote !== null && c.confidence >= 0.7)
}

export function mapHighlights(raw: unknown): HighlightCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const r = asRecord(item)
      return {
        title: typeof r.title === 'string' ? r.title.trim() : '',
        confidence: numConfidence(r.confidence),
        source_quote: strOrNull(r.source_quote),
      }
    })
    .filter((c) => c.title !== '' && c.source_quote !== null && c.confidence >= 0.7)
}

// 참석자 후보: mapTasks와 동일 필터(name 공백 제외, source_quote null 제외, confidence<0.7 제외).
export function mapAttendees(raw: unknown): AttendeeCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const r = asRecord(item)
      const aff = r.affiliation
      return {
        name: typeof r.name === 'string' ? r.name.trim() : '',
        confidence: numConfidence(r.confidence),
        source_quote: strOrNull(r.source_quote),
        affiliation: (aff === 'internal' || aff === 'external' ? aff : 'unknown') as AttendeeAffiliation,
      }
    })
    .filter((c) => c.name !== '' && c.source_quote !== null && c.confidence >= 0.7)
}

// ---- 검색어 sanitize (ilike % 이스케이프) ----
// actions.ts listMeetingNotes의 인라인 로직을 SSOT로 분리.
export function sanitizeSearchQuery(q: string): string {
  return q.replace(/[%,]/g, ' ')
}

// ---- toStartAt: date+time → ISO 문자열 (날짜 없으면 null) ----
// actions.ts applyExtractedItems의 인라인 로직을 SSOT로 분리.
// 시각이 유효하면 그 시각을, 모르면 기본 09:00을 사용한다.
// 항상 KST(+09:00)로 앵커링해 타임존 드리프트를 막는다.
export function toStartAt(
  date: string | null | undefined,
  time: string | null | undefined
): string | null {
  if (!date || !DATE_RE.test(date)) return null
  const hasTime = !!time && TIME_RE.test(time)
  const hhmm = hasTime ? (time as string) : '09:00'
  return `${date}T${hhmm}:00+09:00` // +09:00 앵커(kstWallToIso와 동일 규약). naive 조립 금지.
}
