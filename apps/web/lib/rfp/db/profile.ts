/**
 * 회사 프로필 읽기와 쓰기 — **다섯 부분 전부** (마이그레이션 247)
 *
 * ## 왜 이 파일이 뒤늦게 생겼나
 *
 * 표는 다섯이었다: 기본정보 하나(`rfp_company_profiles.basic`)와 자식 넷
 * (인증·실적·기술·협력사). 그런데 저장은 기본정보만 했고, 자식 넷은
 * **한 번도 쓰이지 않았다.** 적합도를 실제로 가르는 것이 그 넷인데도.
 *
 * 그래서 화면에는 회사 이름·자본금 같은 것만 남았고, 「이걸로 뭘 판정한다는 건가」가 됐다.
 * 표와 라이브러리는 있는데 아무도 안 부르는 것 — 이 저장소에서 반복되는 고장이다.
 *
 * ## 판을 새로 만든다
 *
 * 고칠 때마다 새 판을 만들고 앞 판은 보관으로 돌린다. 자식 행도 판마다 새로 넣는다 —
 * 앞 판의 자식을 고치면 「그때는 인증이 없었다」를 설명할 수 없다.
 */

import type {
  CompanyProfile, ProfileBasic, Certification, TrackRecord, Capability, Partner,
} from '../fit/profile.ts'

export interface ProfileDbClient {
  from(table: string): any
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export const CHILD_TABLES = {
  certifications: 'rfp_profile_certifications',
  trackRecords: 'rfp_profile_track_records',
  capabilities: 'rfp_profile_capabilities',
  partners: 'rfp_profile_partners',
} as const

/** 화면이 보낸 것을 믿지 않는다 — 경계에서 모양을 맞춘다 */
export function normalizeCertification(raw: unknown): Certification | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = str(r.name)
  if (!name) return null
  return { name, issuer: str(r.issuer), validUntil: str(r.validUntil) }
}

export function normalizeTrackRecord(raw: unknown): TrackRecord | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const projectName = str(r.projectName)
  if (!projectName) return null
  return {
    projectName,
    client: str(r.client),
    amountKrw: num(r.amountKrw),
    startDate: str(r.startDate),
    endDate: str(r.endDate),
    domainTags: strList(r.domainTags),
  }
}

export function normalizeCapability(raw: unknown): Capability | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const tag = str(r.tag)
  if (!tag) return null
  // 표가 1~5 로 제약한다. 밖의 값을 그대로 넣으면 저장이 통째로 실패한다
  const level = Math.min(5, Math.max(1, Math.round(num(r.level) ?? 3)))
  return { tag, level }
}

export function normalizePartner(raw: unknown): Partner | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = str(r.name)
  if (!name) return null
  return { name, capabilities: strList(r.capabilities) }
}

export function normalizeBasic(raw: unknown): ProfileBasic {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    companyName: str(r.companyName) ?? '',
    businessNumber: str(r.businessNumber),
    registrations: strList(r.registrations),
    capitalKrw: num(r.capitalKrw),
    annualRevenueKrw: num(r.annualRevenueKrw),
    headcount: num(r.headcount),
    region: str(r.region),
  }
}

/** 요청 본문 전체를 프로필 한 벌로 — 빈 줄은 버린다(사용자가 추가만 하고 안 채운 줄) */
export function normalizeProfileInput(raw: unknown, version = 1): Omit<CompanyProfile, 'status'> {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    version,
    basic: normalizeBasic(r.basic),
    certifications: list(r.certifications).map(normalizeCertification).filter(isSome),
    trackRecords: list(r.trackRecords).map(normalizeTrackRecord).filter(isSome),
    capabilities: list(r.capabilities).map(normalizeCapability).filter(isSome),
    partners: list(r.partners).map(normalizePartner).filter(isSome),
  }
}

/** 프로필 한 벌을 읽는다 — 자식까지 */
export async function loadProfile(
  db: ProfileDbClient, opts: { status?: string } = {},
): Promise<(CompanyProfile & { id: string }) | null> {
  let q = db.from('rfp_company_profiles')
    .select('id, version, status, basic')
    .order('version', { ascending: false })
    .limit(1)
  if (opts.status) q = q.eq('status', opts.status)

  const { data, error } = await q
  if (error) throw new Error(`프로필을 읽지 못했다: ${describe(error)}`)
  const row = (data ?? [])[0] as { id: string; version: number; status: string; basic: unknown } | undefined
  if (!row) return null

  const [certs, records, caps, partners] = await Promise.all([
    childRows(db, CHILD_TABLES.certifications, row.id, 'name, issuer, valid_until'),
    childRows(db, CHILD_TABLES.trackRecords, row.id, 'project_name, client, amount, start_date, end_date, domain_tags'),
    childRows(db, CHILD_TABLES.capabilities, row.id, 'tag, level'),
    childRows(db, CHILD_TABLES.partners, row.id, 'partner_name, capabilities'),
  ])

  return {
    id: String(row.id),
    version: Number(row.version),
    status: row.status as CompanyProfile['status'],
    basic: normalizeBasic(row.basic),
    certifications: certs.map((c: any) => ({
      name: String(c.name), issuer: c.issuer ?? null, validUntil: c.valid_until ?? null,
    })),
    trackRecords: records.map((t: any) => ({
      projectName: String(t.project_name),
      client: t.client ?? null,
      amountKrw: t.amount === null || t.amount === undefined ? null : Number(t.amount),
      startDate: t.start_date ?? null,
      endDate: t.end_date ?? null,
      domainTags: Array.isArray(t.domain_tags) ? t.domain_tags.map(String) : [],
    })),
    capabilities: caps.map((c: any) => ({ tag: String(c.tag), level: Number(c.level ?? 3) })),
    partners: partners.map((p: any) => ({
      name: String(p.partner_name),
      capabilities: Array.isArray(p.capabilities) ? p.capabilities.map(String) : [],
    })),
  }
}

export interface SaveProfileInput {
  orgId: string
  createdBy: string | null
  status: 'draft' | 'active'
  profile: Omit<CompanyProfile, 'status' | 'version'>
}

/**
 * 새 판으로 저장한다.
 *
 * 순서가 규칙이다: 앞 판을 보관으로 돌리고 → 새 판을 만들고 → 자식을 넣는다.
 * 자식부터 넣으면 부모가 실패했을 때 주인 없는 행이 남는다.
 */
export async function saveProfile(
  db: ProfileDbClient, input: SaveProfileInput,
): Promise<CompanyProfile & { id: string }> {
  const { data: last } = await db.from('rfp_company_profiles')
    .select('version').order('version', { ascending: false }).limit(1).maybeSingle()
  const version = Number((last as { version?: number } | null)?.version ?? 0) + 1

  if (input.status === 'active') {
    // 지난 판정이 가리키는 프로필은 지우지 않는다 — 보관으로만 돌린다
    await db.from('rfp_company_profiles').update({ status: 'archived' }).eq('status', 'active')
  }

  const { data, error } = await db.from('rfp_company_profiles')
    .insert({
      org_id: input.orgId,
      version,
      status: input.status,
      basic: input.profile.basic,
      created_by: input.createdBy,
    })
    .select('id, version, status')
    .single()
  if (error || !data) throw new Error(`프로필을 저장하지 못했다: ${describe(error)}`)
  const profileId = String((data as { id: string }).id)

  await insertChildren(db, input.orgId, profileId, input.profile)

  return { ...input.profile, id: profileId, version, status: input.status }
}

async function insertChildren(
  db: ProfileDbClient, orgId: string, profileId: string,
  p: Omit<CompanyProfile, 'status' | 'version'>,
): Promise<void> {
  const jobs: Promise<void>[] = []

  if (p.certifications.length > 0) {
    jobs.push(insert(db, CHILD_TABLES.certifications, p.certifications.map((c) => ({
      org_id: orgId, profile_id: profileId,
      name: c.name, issuer: c.issuer, valid_until: c.validUntil,
    }))))
  }
  if (p.trackRecords.length > 0) {
    jobs.push(insert(db, CHILD_TABLES.trackRecords, p.trackRecords.map((t) => ({
      org_id: orgId, profile_id: profileId,
      project_name: t.projectName, client: t.client, amount: t.amountKrw,
      start_date: t.startDate, end_date: t.endDate, domain_tags: t.domainTags,
    }))))
  }
  if (p.capabilities.length > 0) {
    jobs.push(insert(db, CHILD_TABLES.capabilities, p.capabilities.map((c) => ({
      org_id: orgId, profile_id: profileId, tag: c.tag, level: c.level,
    }))))
  }
  if (p.partners.length > 0) {
    jobs.push(insert(db, CHILD_TABLES.partners, p.partners.map((x) => ({
      org_id: orgId, profile_id: profileId, partner_name: x.name, capabilities: x.capabilities,
    }))))
  }

  await Promise.all(jobs)
}

async function insert(db: ProfileDbClient, table: string, rows: unknown[]): Promise<void> {
  const { error } = await db.from(table).insert(rows)
  // supabase-js 는 실패를 던지지 않고 돌려준다. 검사하지 않으면 0건이 성공으로 보인다
  if (error) throw new Error(`${table} 에 넣지 못했다: ${describe(error)}`)
}

async function childRows(db: ProfileDbClient, table: string, profileId: string, cols: string) {
  const { data, error } = await db.from(table).select(cols).eq('profile_id', profileId)
  if (error) throw new Error(`${table} 을 읽지 못했다: ${describe(error)}`)
  return (data ?? []) as Record<string, unknown>[]
}

/**
 * 판정에 쓸 만한가 — **무엇이 비었는지**를 함께 돌려준다.
 *
 * 「부족합니다」만 띄우면 사용자는 무엇을 채워야 하는지 모른 채 화면을 떠난다.
 */
export function missingForAssessment(p: Omit<CompanyProfile, 'status' | 'version'>): string[] {
  const gaps: string[] = []
  if (!p.basic.companyName.trim()) gaps.push('companyName')
  if (p.trackRecords.length === 0) gaps.push('trackRecords')
  if (p.certifications.length === 0) gaps.push('certifications')
  if (p.basic.headcount === null) gaps.push('headcount')
  return gaps
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : []
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function isSome<T>(v: T | null): v is T {
  return v !== null
}
function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
