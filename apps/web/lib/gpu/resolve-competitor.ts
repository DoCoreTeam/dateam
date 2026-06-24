// 경쟁사(회사) 식별·병합 SSOT (순수 함수 — node:test 대상).
//
// 왜: 경쟁사 식별이 name ilike 단일 매칭뿐이라 같은 회사가 표기 변형으로 중복됨
//   (CLOUDV ↔ CLOUDV (Smileserv), Lambda ↔ Lambda Labs).
// 정책(사용자 확정):
//   - 자동 병합 판정은 "도메인 일치" 우선, 차선은 "정규화 이름/별칭 일치"뿐.
//   - 이름 토큰이 일부 겹친다고 자동 병합 금지(과병합 차단: Elice/Kakao/NHN/SaladCloud 가 'Cloud' 공유).
//   - 캐노니컬 1개 + 별칭(aliases) 보존 → 같은 표기 재유입 시 자동 흡수.
//   - 해소 실패 시 null(자동 생성은 호출부 책임 — gpu_products 자동생성 사고와 동일 원칙).

/** 한국/일본/영국 등 2단계 TLD — 등록가능 도메인 산출 시 라벨 1개 더 보존. */
const TWO_LEVEL_TLDS = new Set([
  'co.kr', 'ne.kr', 'or.kr', 'go.kr', 're.kr', 'pe.kr', 'kr.com',
  'co.jp', 'ne.jp', 'or.jp',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
  'com.au', 'com.cn', 'com.br', 'com.sg', 'com.hk', 'com.tw',
])

/** URL/도메인 문자열 → 등록가능 도메인(소문자). scheme·www·경로·포트 제거. 판정 불가 시 null. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null
  let s = String(input).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme://
  s = s.split('/')[0].split('?')[0].split('#')[0].split('@').pop()!.split(':')[0]
  s = s.replace(/^www\./, '')
  if (!s.includes('.')) return null
  const labels = s.split('.').filter(Boolean)
  if (labels.length < 2) return null
  const last2 = labels.slice(-2).join('.')
  if (TWO_LEVEL_TLDS.has(last2) && labels.length >= 3) {
    return labels.slice(-3).join('.')
  }
  return last2
}

/** 회사명 정규화: 소문자 + 괄호내용 제거 + 영숫자/한글만 보존 + 공백 정리.
 *  CLOUDV (Smileserv) → "cloudv" (괄호 제거로 CLOUDV와 동일 판정).
 *  Lambda vs Lambda Labs 는 동일 판정 안 됨(의도 — 도메인/수동으로만 병합). */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export interface CompetitorIdentity {
  id: string
  name: string
  short_name?: string | null
  website_url?: string | null
  aliases?: string[] | null
}

/** 입력(이름+도메인)을 기존 경쟁사로 해소. ①도메인 일치 ②정규화 이름/별칭 일치 ③없으면 null. */
export function resolveCompetitorId(
  input: { name: string; website_url?: string | null },
  existing: CompetitorIdentity[],
): string | null {
  const inDomain = normalizeDomain(input.website_url)
  if (inDomain) {
    const byDomain = existing.find((c) => normalizeDomain(c.website_url) === inDomain)
    if (byDomain) return byDomain.id
  }
  const inName = normalizeCompanyName(input.name)
  if (inName) {
    const byName = existing.find((c) => {
      if (normalizeCompanyName(c.name) === inName) return true
      if (c.short_name && normalizeCompanyName(c.short_name) === inName) return true
      return (c.aliases ?? []).some((a) => normalizeCompanyName(a) === inName)
    })
    if (byName) return byName.id
  }
  return null
}

export interface MergeSuggestion {
  /** 클러스터 대표 id(루트) — UI 키 용도. */
  key: string
  reason: 'domain' | 'name'
  competitor_ids: string[]
}

/** 기존 경쟁사들 중 같은 회사로 보이는 클러스터(2개+) 산출. 도메인 일치 또는 정규화 이름 일치로 묶음(union-find). */
export function findMergeSuggestions(competitors: CompetitorIdentity[]): MergeSuggestion[] {
  const parent = new Map<string, string>()
  for (const c of competitors) parent.set(c.id, c.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let cur = x
    while (parent.get(cur) !== r) { const next = parent.get(cur)!; parent.set(cur, r); cur = next }
    return r
  }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

  const domainFirst = new Map<string, string>()
  const nameFirst = new Map<string, string>()
  for (const c of competitors) {
    const d = normalizeDomain(c.website_url)
    if (d) {
      const prev = domainFirst.get(d)
      if (prev) union(c.id, prev); else domainFirst.set(d, c.id)
    }
    const n = normalizeCompanyName(c.name)
    if (n) {
      const prev = nameFirst.get(n)
      if (prev) union(c.id, prev); else nameFirst.set(n, c.id)
    }
  }

  const clusters = new Map<string, string[]>()
  for (const c of competitors) {
    const root = find(c.id)
    clusters.set(root, [...(clusters.get(root) ?? []), c.id])
  }

  const byId = new Map(competitors.map((c) => [c.id, c]))
  const out: MergeSuggestion[] = []
  for (const [root, ids] of Array.from(clusters.entries())) {
    if (ids.length < 2) continue
    // 같은 도메인 쌍이 하나라도 있으면 'domain', 아니면 'name'
    const domains = ids.map((id) => normalizeDomain(byId.get(id)?.website_url)).filter(Boolean)
    const hasDomainPair = new Set(domains).size < domains.length && domains.length >= 2
    out.push({ key: root, reason: hasDomainPair ? 'domain' : 'name', competitor_ids: ids })
  }
  return out
}

export interface MappingLite {
  id: string
  competitor_id: string
  gpu_product_id: string
  pricing_model: string | null
}

export interface MergePlan {
  /** competitor_id 를 캐노니컬로 이관할 매핑 id(충돌 없음). */
  repointMappingIds: string[]
  /** 충돌 매핑: from 의 market_prices 를 to(캐노니컬 기존 매핑)로 이관. */
  collisions: { fromMappingId: string; toMappingId: string }[]
  /** 충돌로 흡수되어 비활성화할 매핑 id. */
  deactivateMappingIds: string[]
  /** 캐노니컬에 보존할 별칭(흡수 회사 이름·약칭·별칭 합집합, 캐노니컬 이름 제외). */
  aliases: string[]
  /** soft-delete 할 흡수 회사 id. */
  absorbedIds: string[]
}

/** 병합 계획(순수) — 매핑 충돌((product, pricing_model) 중복)은 시세 이관 후 비활성, 그 외는 이관. */
export function planCompetitorMerge(
  canonical: CompetitorIdentity,
  absorbed: CompetitorIdentity[],
  mappings: MappingLite[],
): MergePlan {
  const canonicalId = canonical.id
  const absorbedIds = absorbed.map((a) => a.id)
  const absorbedSet = new Set(absorbedIds)
  const mapKey = (m: MappingLite) => `${m.gpu_product_id}::${m.pricing_model ?? ''}`

  // 캐노니컬이 이미 가진 (product, pricing_model) → 매핑 id
  const claimed = new Map<string, string>()
  for (const m of mappings) {
    if (m.competitor_id === canonicalId) claimed.set(mapKey(m), m.id)
  }

  const repoint: string[] = []
  const collisions: { fromMappingId: string; toMappingId: string }[] = []
  const deactivate: string[] = []
  for (const m of mappings) {
    if (!absorbedSet.has(m.competitor_id)) continue
    const k = mapKey(m)
    const owner = claimed.get(k)
    if (owner) {
      collisions.push({ fromMappingId: m.id, toMappingId: owner })
      deactivate.push(m.id)
    } else {
      repoint.push(m.id)
      claimed.set(k, m.id) // 이관될 이 매핑이 키 소유 → 흡수 회사끼리 중복도 차단
    }
  }

  const aliasSet = new Set<string>()
  const add = (s?: string | null) => { const t = s?.trim(); if (t) aliasSet.add(t) }
  ;(canonical.aliases ?? []).forEach(add)
  for (const a of absorbed) { add(a.name); add(a.short_name); (a.aliases ?? []).forEach(add) }
  aliasSet.delete(canonical.name.trim())

  return {
    repointMappingIds: repoint,
    collisions,
    deactivateMappingIds: deactivate,
    aliases: Array.from(aliasSet),
    absorbedIds,
  }
}
