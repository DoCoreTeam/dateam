/**
 * 사업 유형 — «무엇을 파는 일인가»의 목록
 *
 * **왜 이 파일이 있나**(사용자 지적 2026-09-08: 「사업유형 설정하는 곳이 없어」):
 * 예전에는 `lib/terms/ledger.ts` 의 상수 8개가 전부였다. 코드에 박혀 있으니
 * 「유지보수」 사업이 들어와도 「기타」로 적을 수밖에 없었고, 그러면
 * 「어떤 사업이 남는 장사였나」에 영원히 답할 수 없다.
 *
 * 이제 목록은 **워크스페이스 표**(`crm_business_type`, 마이그 242)다.
 * 이 파일은 그 표를 다루는 **순수 규칙**만 갖는다 — DB 도 Prisma 도 import 하지 않는다.
 * 화면(클라이언트)과 서비스(서버)가 같은 규칙을 봐야 하기 때문이다
 * (`setting-group.ts` 가 같은 이유로 분리돼 있다).
 */

import { BUSINESS_TYPE_LABEL, BUSINESS_TYPE_ORDER, type BusinessTypeKey } from '../../terms/ledger.ts'

export interface BusinessTypeRow {
  id: string
  /** 딜에 저장되는 값 */
  key: string
  /** 화면에 보이는 이름 */
  label: string
  position: number
  /** 기본 8종인가 — 지울 수 없고 «숨김»만 된다 */
  isBuiltin: boolean
  /** 새 딜에서 고를 수 있나 */
  isActive: boolean
  /** 이 유형을 쓰는 딜 수 — 「지워도 되나」에 답하는 유일한 숫자 */
  dealCount?: number
}

/** 이름 길이 상한 — 목록·표·견적서 칸에 들어가야 한다 */
export const BUSINESS_TYPE_LABEL_MAX = 20

/**
 * 처음 심는 기본 8종.
 *
 * **이것은 «기본값»이지 «진실»이 아니다.** 워크스페이스가 이름을 바꾸면 그쪽이 맞다.
 * 마이그 242 의 시드와 같은 값이어야 한다 — 가드가 그것을 확인한다.
 */
export const BUILTIN_BUSINESS_TYPES: readonly { key: string; label: string; position: number }[] =
  BUSINESS_TYPE_ORDER.map((k, i) => ({
    key: k,
    label: BUSINESS_TYPE_LABEL[k as BusinessTypeKey],
    position: i,
  }))

const BUILTIN_KEYS: ReadonlySet<string> = new Set(BUSINESS_TYPE_ORDER as readonly string[])

/**
 * 이 키를 예전 enum 칼럼(`crm_deal.businessType`)에도 함께 쓸 수 있나.
 *
 * 사용자가 추가한 유형은 enum 에 없으므로 못 쓴다 — 그때는 enum 칼럼을 비운다.
 * (Postgres enum 은 값을 지울 수 없어서 사용자 추가분을 담을 수 없다. 그것이 표로 내린 이유다)
 */
export function isBuiltinBusinessTypeKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && BUILTIN_KEYS.has(key)
}

/** 이름 다듬기 — 앞뒤 공백과 연속 공백을 없앤다. 「GPU  사업」과 「GPU 사업」이 둘이 되면 안 된다 */
export function normalizeBusinessTypeLabel(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/** 같은 이름인가 — 대소문자·공백 차이는 같은 것으로 본다 */
export function isSameBusinessTypeLabel(a: string, b: string): boolean {
  return normalizeBusinessTypeLabel(a).toLowerCase() === normalizeBusinessTypeLabel(b).toLowerCase()
}

export type BusinessTypeLabelError = 'EMPTY' | 'TOO_LONG' | 'DUPLICATE'

/**
 * 새 이름이 쓸 만한가. 화면과 서버가 **같은 함수**로 판정한다 —
 * 화면만 막으면 API 로 들어오는 값이 통과하고, 서버만 막으면 사용자가 저장 눌러야 안다.
 *
 * @param existing 이미 있는 이름들(살아 있는 행만). 자기 자신은 호출부가 빼고 넘긴다
 */
export function validateBusinessTypeLabel(
  raw: string | null | undefined, existing: readonly string[],
): BusinessTypeLabelError | null {
  const label = normalizeBusinessTypeLabel(raw)
  if (!label) return 'EMPTY'
  if (label.length > BUSINESS_TYPE_LABEL_MAX) return 'TOO_LONG'
  if (existing.some((e) => isSameBusinessTypeLabel(e, label))) return 'DUPLICATE'
  return null
}

export const BUSINESS_TYPE_LABEL_ERROR_TEXT: Record<BusinessTypeLabelError, string> = {
  EMPTY: '사업 유형 이름을 입력해 주세요.',
  TOO_LONG: `사업 유형 이름은 ${BUSINESS_TYPE_LABEL_MAX}자까지 넣을 수 있어요.`,
  DUPLICATE: '같은 이름의 사업 유형이 이미 있어요.',
}

/**
 * 화면에 세울 순서.
 *
 * 숨긴 유형은 **아래로 내린다** — 지우는 게 아니라 안 보이게 하는 것이므로
 * 목록에서 사라지면 다시 켤 길이 없어진다.
 */
export function sortBusinessTypes<T extends { position: number; isActive: boolean; label: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.position !== b.position) return a.position - b.position
    return a.label.localeCompare(b.label, 'ko')
  })
}

/**
 * 저장된 키를 보여 줄 이름으로.
 *
 * **모르는 키도 감추지 않는다.** 유형을 지운 뒤 그 유형이던 딜을 열면
 * 빈 칸이 아니라 키라도 보여야 「무슨 일이 있었나」를 알 수 있다.
 */
export function businessTypeLabelOf(
  key: string | null | undefined, rows: readonly BusinessTypeRow[],
): string | null {
  if (!key) return null
  const hit = rows.find((r) => r.key === key)
  if (hit) return hit.label
  // 표에 없으면 기본 8종 상수라도 뒤진다 — 목록을 아직 못 받아 온 순간에도 이름이 나온다
  if (isBuiltinBusinessTypeKey(key)) return BUSINESS_TYPE_LABEL[key as BusinessTypeKey]
  return key
}

/**
 * 딜 폼이 고를 수 있는 목록.
 *
 * 켜진 것 + **지금 이 딜이 이미 쓰고 있는 것**. 뒤엣것을 빼면
 * 유형을 숨긴 뒤 그 딜을 수정할 때 값이 조용히 날아간다.
 */
export function selectableBusinessTypes(
  rows: readonly BusinessTypeRow[], currentKey: string | null | undefined,
): BusinessTypeRow[] {
  return sortBusinessTypes(rows.filter((r) => r.isActive || r.key === currentKey))
}

/**
 * 딜에서 사업 유형 키를 꺼낸다.
 *
 * 새 칼럼(`businessTypeKey`)이 진실이지만, 예전 enum 칼럼만 채워진 행이 남아 있을 수 있다
 * (마이그 242 백필 전에 만들어진 것·다른 경로로 들어온 것). 둘 다 본다 —
 * 한쪽만 보면 그 행의 유형이 화면에서 조용히 사라진다.
 */
export function dealBusinessTypeKey(
  row: { businessTypeKey?: string | null; businessType?: string | null } | null | undefined,
): string | null {
  return row?.businessTypeKey ?? row?.businessType ?? null
}
