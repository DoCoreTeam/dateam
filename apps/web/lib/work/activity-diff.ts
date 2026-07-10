// 활동이력 변경내용 자연어화 SSOT — audit_log의 before/after 행 스냅샷을
// 사람이 읽는 필드단위 변경 목록으로 바꾼다(이력 탭이 raw JSON 덤프 대신 이걸 렌더).
// 라벨/값 포맷을 한 곳에 둬 화면마다 인라인 복붙 금지(디자인 §2·재사용 정책).
//   - 수정: `레이블: 이전값 → 새값`(바뀐 필드만) → 되살리기 전에 무엇이 바뀌는지 명확.
//   - 생성/삭제: `레이블: 값`(생성은 새값, 삭제는 지워진 값).

import { PRIORITY_COLORS, STATUS_COLORS, type PriorityKey, type StatusKey } from '../tokens/status-colors.ts'
import { statusBadge, budgetLabel } from './project-display.ts'
import { htmlToPlain } from '../html-to-plain.ts'

// 사용자에게 의미 있는 필드만 화이트리스트(표시 순서 겸용). 여기 없는 컬럼
// (id·user_id·embedding·created_at·ai_processed·*_id UUID 등)은 이력에서 숨긴다.
const DISPLAY_ORDER: string[] = [
  // daily / dept_task
  'content', 'entry_type', 'priority', 'progress', 'checklist', 'target_date', 'is_resolved', 'memo_status',
  // project
  'name', 'status', 'budget', 'currency', 'start_date', 'end_date', 'year', 'quarter', 'half', 'month',
  // weekly_report
  'category', 'week_start', 'performance', 'plan', 'issues',
]

export const FIELD_LABEL: Record<string, string> = {
  content: '내용', entry_type: '상태', priority: '우선순위', progress: '진행률',
  checklist: '체크리스트', target_date: '목표일', is_resolved: '해결됨', memo_status: '메모상태',
  name: '프로젝트명', status: '상태', budget: '예산', currency: '통화',
  start_date: '시작일', end_date: '종료일', year: '연도', quarter: '분기', half: '반기', month: '월',
  category: '카테고리', week_start: '주차', performance: '실적', plan: '계획', issues: '이슈',
}

const HALF_LABEL: Record<string, string> = { H1: '상반기', H2: '하반기' }
const MAX_TEXT = 120

// 단일 필드 값 → 자연어 문자열. 값 없음은 '없음'.
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '없음'

  switch (field) {
    case 'priority':
      return PRIORITY_COLORS[value as PriorityKey]?.label ?? String(value)
    case 'entry_type':
      return STATUS_COLORS[value as StatusKey]?.label ?? String(value)
    case 'status':
      return statusBadge(String(value)).label
    case 'progress':
      return `${value}%`
    case 'budget': {
      const n = Number(value)
      return Number.isFinite(n) ? (budgetLabel(n, null) ?? String(value)) : String(value)
    }
    case 'half':
      return HALF_LABEL[String(value)] ?? String(value)
    case 'is_resolved':
      return value ? '예' : '아니오'
    case 'checklist':
      return formatChecklist(value)
    case 'performance':
    case 'plan':
    case 'issues':
      return truncate(htmlToPlain(String(value)))
    default:
      return truncate(String(value))
  }
}

function formatChecklist(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '없음'
  const parts = value.map((it) => {
    const item = it as { done?: boolean; label?: string }
    const mark = item?.done ? '✓' : '○'
    return `${mark} ${item?.label ?? ''}`.trim()
  })
  return parts.join(', ')
}

function truncate(s: string): string {
  const t = s.trim()
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t
}

export interface ActivityChange {
  field: string
  label: string
  from: string | null   // 이전값(생성이면 null)
  to: string | null     // 새값(삭제면 null)
}

// ── 주간보고 전용: 주차 전체 행 배열(rows_json) before/after diff ──
// 주간 저장은 카테고리별 행 교체(replace)라 daily식 단일행 diff가 안 맞는다.
// 변경 전/후 rows를 (카테고리+seq)로 짝지어 실적/계획/이슈가 바뀐 것만 자연어로.
export interface WeeklyRow {
  category?: string | null
  seq?: number | null
  performance?: string | null
  plan?: string | null
  issues?: string | null
}

const WEEKLY_SUBFIELDS: Array<{ key: keyof WeeklyRow; label: string }> = [
  { key: 'performance', label: '실적' }, { key: 'plan', label: '계획' }, { key: 'issues', label: '이슈' },
]

function rowKey(r: WeeklyRow): string {
  return `${(r.category ?? '').trim()}#${r.seq ?? 0}`
}

/**
 * 주간 rows_json 배열 before/after를 카테고리행 단위 변경목록으로.
 * 각 변경 = `카테고리 · 실적/계획/이슈` 별 이전→새 텍스트(HTML은 plain).
 * 추가된 행(before 없음)=생성, 사라진 행(after 없음)=삭제로 표기.
 */
export function diffWeeklyRows(beforeRows: WeeklyRow[] | null, afterRows: WeeklyRow[] | null): ActivityChange[] {
  const before = Array.isArray(beforeRows) ? beforeRows : []
  const after = Array.isArray(afterRows) ? afterRows : []
  const beforeMap = new Map(before.map((r) => [rowKey(r), r]))
  const afterMap = new Map(after.map((r) => [rowKey(r), r]))
  const keys: string[] = []
  for (const r of [...before, ...after]) {
    const k = rowKey(r)
    if (!keys.includes(k)) keys.push(k)
  }

  const out: ActivityChange[] = []
  for (const k of keys) {
    const b = beforeMap.get(k)
    const a = afterMap.get(k)
    const category = (a?.category ?? b?.category ?? '').trim() || '항목'
    for (const sub of WEEKLY_SUBFIELDS) {
      const bv = b ? b[sub.key] : undefined
      const av = a ? a[sub.key] : undefined
      if (sameValue(bv ?? '', av ?? '')) continue
      out.push({
        field: `${k}:${String(sub.key)}`,
        label: `${category} · ${sub.label}`,
        from: b ? formatFieldValue(sub.key, bv) : null,
        to: a ? formatFieldValue(sub.key, av) : null,
      })
    }
  }
  return out
}

type Snapshot = Record<string, unknown> | null

function get(snap: Snapshot, field: string): unknown {
  return snap ? snap[field] : undefined
}

// 대략 동일 판정 — 원시값/배열·객체 JSON 비교(스냅샷은 순수 JSON이라 안전).
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return true
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  }
  return false
}

/**
 * before/after 스냅샷을 필드단위 변경목록으로.
 *  - 'update': 값이 바뀐 화이트리스트 필드만.
 *  - 'create': after의 값 있는 필드(from=null).
 *  - 'delete': before의 값 있는 필드(to=null).
 */
export function diffSnapshots(action: string, before: Snapshot, after: Snapshot): ActivityChange[] {
  const out: ActivityChange[] = []
  const isCreate = action === 'create'
  const isDelete = action === 'delete'

  for (const field of DISPLAY_ORDER) {
    const label = FIELD_LABEL[field]
    if (!label) continue
    const b = get(before, field)
    const a = get(after, field)

    if (isCreate) {
      if (a === null || a === undefined || a === '') continue
      out.push({ field, label, from: null, to: formatFieldValue(field, a) })
      continue
    }
    if (isDelete) {
      if (b === null || b === undefined || b === '') continue
      out.push({ field, label, from: formatFieldValue(field, b), to: null })
      continue
    }
    // update(및 그 외 op): 바뀐 것만
    if (!sameValue(b, a)) {
      out.push({ field, label, from: formatFieldValue(field, b), to: formatFieldValue(field, a) })
    }
  }
  return out
}
