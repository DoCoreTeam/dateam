// 개발자센터 왼쪽 목록의 주소 상태 (P0168)
//
// 예전에는 절 전환이 useState 하나라 새로고침하면 늘 시작하기로 돌아갔고 링크로 절을 건넬 수 없었다
// 이제 ?section=<절> 과 #<엔드포인트 id> 를 주소에 남긴다
// 우선순위는 주소 > 기본값, 모르는 값은 들이지 않고 기본 절로 간다
// 첫 렌더는 언제나 기본 절이다, 서버 렌더와 달라지면 하이드레이션이 깨진다 (주소는 마운트 뒤에 읽는다)

export const DEFAULT_SECTION = 'start'
export const SECTION_PARAM = 'section'

/** 참고 묶음을 셋으로 나눈 절, 각 절은 registry 의 엔드포인트 한 건을 그린다 */
export const REF_SECTION_ENDPOINT = {
  'ref-me': 'ref.me',
  'ref-approval': 'ref.approval',
  'ref-spec': 'ref.openapi',
} as const
export type RefSectionId = keyof typeof REF_SECTION_ENDPOINT
export const REF_SECTION_IDS = Object.keys(REF_SECTION_ENDPOINT) as RefSectionId[]

/**
 * 예전 절 이름, 옛 링크와 registry 의 CATALOG_NOTE.ref.section 이 아직 이 이름을 쓴다
 * 「OpenAPI」 단추였으므로 스펙 절로 보낸다
 */
export const SECTION_ALIASES: Readonly<Record<string, string>> = { ref: 'ref-spec' }

/**
 * 고른 코드 언어를 실제로 따르는 예시(CodeTabs 또는 언어별 CodeBlock)가 있는 절
 * 그 밖의 절(AI 공통층, CLI, 직접 실행, 게이트웨이)에는 언어 선택기를 그리지 않는다
 * 아무것도 안 바꾸는 선택기는 고를 수 있게 만든 것이 아니다
 */
export const SECTIONS_WITH_CODE: ReadonlySet<string> = new Set([
  'start', 'gpu', 'crm', 'ci', 'legacy', ...REF_SECTION_IDS, 'errors',
])

export function hasCode(section: string): boolean {
  return SECTIONS_WITH_CODE.has(section)
}

type Known = ReadonlySet<string> | readonly string[]
const isKnown = (known: Known, id: string) =>
  Array.isArray(known) ? known.includes(id) : (known as ReadonlySet<string>).has(id)

/** 별칭을 풀고 아는 절이면 돌려준다, 모르면 null */
export function resolveSection(raw: string | null | undefined, known: Known): string | null {
  if (!raw) return null
  const id = SECTION_ALIASES[raw] ?? raw
  return isKnown(known, id) ? id : null
}

function decodeHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  try { return decodeURIComponent(raw) } catch { return raw }
}

/**
 * 주소에서 절과 앵커를 읽는다
 * 앵커가 아는 엔드포인트면 그 엔드포인트가 있는 절이 이긴다 (더 좁은 쪽을 따른다)
 * 앵커가 절 이름이면 그 절로 간다, 그 밖의 앵커는 버린다
 */
export function parseSection(
  search: string,
  hash: string,
  known: Known,
  anchorToSection: Readonly<Record<string, string>>,
): { section: string; anchor: string | null } {
  const anchor = decodeHash(hash)
  if (anchor) {
    const owner = Object.prototype.hasOwnProperty.call(anchorToSection, anchor) ? anchorToSection[anchor] : undefined
    const fromAnchor = resolveSection(owner, known)
    if (fromAnchor) return { section: fromAnchor, anchor }
    const asSection = resolveSection(anchor, known)
    if (asSection) return { section: asSection, anchor: null }
  }
  const fromParam = resolveSection(new URLSearchParams(search).get(SECTION_PARAM), known)
  return { section: fromParam ?? DEFAULT_SECTION, anchor: null }
}

/**
 * 절을 고른 뒤의 주소 (경로 뒤의 ?…#… 부분)
 * 다른 쿼리(?lang= 등)는 그대로 둔다, 기본 절이면 section 을 빼 주소를 짧게 둔다
 */
export function buildHref(search: string, section: string, anchor?: string | null): string {
  const params = new URLSearchParams(search)
  if (section === DEFAULT_SECTION) params.delete(SECTION_PARAM)
  else params.set(SECTION_PARAM, section)
  const q = params.toString()
  return `${q ? `?${q}` : ''}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`
}
