/**
 * 이관 매핑 규칙 (dacrm T0-11) — 순수 함수. DB 를 모른다.
 *
 * 원본: 호스트 '프로젝트관리'(/lead-intake, /deals)의 accounts · contacts · deals
 * 대상: crm_company · crm_person · crm_deal
 *
 * 이관은 한 번 하고 끝나는 일이 아니라 **틀리면 되돌리기 어려운** 일이다.
 * 그래서 매핑을 여기 순수 함수로 떼어 놓고, 드라이런이 이 함수만으로 리포트를 만든다.
 */

/** 호스트 딜 스테이지 8종 (app/(member)/deals/DealForm.tsx:11) */
export const HOST_STAGES = ['신규', '검증', '컨택', 'PoC', '제안', '협상', '수주', '실패'] as const
export type HostStage = (typeof HOST_STAGES)[number]

/** 시드가 만든 GPU 인프라 파이프라인 스테이지 id (prisma/seed-data.ts) */
export const TARGET_PIPELINE_ID = 'pl_gpu'

/**
 * 스테이지 매핑 — 순서가 아니라 **의미**로 맞춘다.
 * 호스트는 PoC 가 제안보다 앞이고 CRM 은 반대다. 번호로 맞추면 뜻이 뒤집힌다.
 */
export const STAGE_MAP: Record<HostStage, { stageId: string; status: 'OPEN' | 'WON' | 'LOST' }> = {
  '신규': { stageId: 'st_gpu_1', status: 'OPEN' },  // 리드
  '검증': { stageId: 'st_gpu_2', status: 'OPEN' },  // 요구사항 파악
  '컨택': { stageId: 'st_gpu_2', status: 'OPEN' },  // 요구사항 파악 (검증과 합쳐진다 — 아래 주의)
  'PoC':  { stageId: 'st_gpu_4', status: 'OPEN' },  // 기술검증(PoC)
  '제안': { stageId: 'st_gpu_3', status: 'OPEN' },  // 견적·제안
  '협상': { stageId: 'st_gpu_5', status: 'OPEN' },  // 계약 협상
  '수주': { stageId: 'st_gpu_6', status: 'WON' },   // 수주
  '실패': { stageId: 'st_gpu_7', status: 'LOST' },  // 실주
}

/** 두 호스트 스테이지가 한 CRM 스테이지로 합쳐진다 — 리포트에 반드시 표시한다 */
export const LOSSY_STAGES: readonly HostStage[] = ['검증', '컨택']

export type Verdict = 'ok' | 'needs_input' | 'unknown_stage'

export interface HostDeal {
  id: string
  title: string | null
  stage: string | null
  value: string | number | null
  close_date: string | null
  fit_score: number | null
  account_id: string | null
  description?: string | null
  next_action?: string | null
  lead_type?: string | null
  product?: string | null
}

export interface MappedDeal {
  verdict: Verdict
  /** 사람이 읽을 사유. verdict 가 ok 가 아니면 반드시 채운다 */
  reason?: string
  sourceId: string
  name: string
  stageId: string
  status: 'OPEN' | 'WON' | 'LOST'
  amountMinor: bigint | null
  currency: 'KRW' | null
  expectedCloseDate: Date | null
  healthScore: number | null
  /** 대응 필드가 없어 메모로 보존할 것 */
  carriedNote: string | null
}

/** numeric(원 단위) → BigInt minor(KRW 는 원이 곧 minor) */
export function toAmountMinor(value: string | number | null): bigint | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return BigInt(Math.round(n))
}

/** 대응 필드가 없는 값들을 사람이 읽을 메모 한 덩어리로 만든다 (버리지 않는다) */
export function carryOver(d: HostDeal): string | null {
  const parts: string[] = []
  if (d.lead_type) parts.push(`유형: ${d.lead_type}`)
  if (d.product) parts.push(`제품: ${d.product}`)
  if (d.next_action) parts.push(`다음 액션: ${d.next_action}`)
  if (d.description) parts.push(`설명: ${d.description}`)
  return parts.length > 0 ? parts.join('\n') : null
}

export function mapDeal(d: HostDeal): MappedDeal {
  const name = (d.title ?? '').trim() || '(제목 없음)'
  const amountMinor = toAmountMinor(d.value)
  const carriedNote = carryOver(d)
  const base = {
    sourceId: d.id,
    name,
    amountMinor,
    currency: amountMinor === null ? null : ('KRW' as const),
    expectedCloseDate: d.close_date ? new Date(`${d.close_date}T00:00:00+09:00`) : null,
    healthScore: d.fit_score ?? null,
    carriedNote,
  }

  const hostStage = (d.stage ?? '') as HostStage
  const target = STAGE_MAP[hostStage]
  if (!target) {
    return {
      ...base, verdict: 'unknown_stage',
      reason: `호스트 스테이지 '${d.stage ?? '(비어 있음)'}' 를 매핑할 수 없다`,
      stageId: 'st_gpu_1', status: 'OPEN',
    }
  }

  // chk_won: WON 은 성사일과 금액이 둘 다 있어야 저장된다. 없으면 사람이 채워야 한다
  if (target.status === 'WON' && amountMinor === null) {
    return {
      ...base, verdict: 'needs_input',
      reason: '수주인데 금액이 없다. 금액 없이는 저장할 수 없다(chk_won)',
      stageId: target.stageId, status: target.status,
    }
  }

  // chk_lost: LOST 는 사유가 필요하다. 호스트에는 실주 사유 필드가 없다
  if (target.status === 'LOST') {
    return {
      ...base, verdict: 'needs_input',
      reason: '실패인데 실주 사유가 없다. 호스트에는 사유 필드가 없어 사람이 채워야 한다(chk_lost)',
      stageId: target.stageId, status: target.status,
    }
  }

  return { ...base, verdict: 'ok', stageId: target.stageId, status: target.status }
}

export interface HostAccount {
  id: string
  name: string | null
  website: string | null
  industry: string | null
  region: string | null
  description: string | null
}

/** website → domain 정규화 (소문자, 스킴·www·경로 제거). 실패하면 null */
export function toDomain(website: string | null): string | null {
  if (!website) return null
  const raw = website.trim().toLowerCase()
  if (!raw) return null
  const stripped = raw.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0]
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(stripped) ? stripped : null
}

export interface MappedCompany {
  verdict: Verdict
  reason?: string
  sourceId: string
  name: string
  domain: string | null
  industry: string | null
  region: string | null
  descriptionMd: string | null
}

export function mapAccount(a: HostAccount): MappedCompany {
  const name = (a.name ?? '').trim()
  return {
    verdict: name ? 'ok' : 'needs_input',
    reason: name ? undefined : '회사명이 비어 있다',
    sourceId: a.id,
    name: name || '(이름 없음)',
    domain: toDomain(a.website),
    industry: a.industry,
    region: a.region,
    descriptionMd: a.description,
  }
}

export interface HostContact {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  title: string | null
  notes: string | null
  account_id: string | null
}

export interface MappedPerson {
  verdict: Verdict
  reason?: string
  sourceId: string
  name: string
  email: string | null
  phone: string | null
  title: string | null
  memo: string | null
  accountId: string | null
}

export function mapContact(c: HostContact): MappedPerson {
  const name = (c.name ?? '').trim()
  const email = c.email ? c.email.trim().toLowerCase() : null
  return {
    verdict: name ? 'ok' : 'needs_input',
    reason: name ? undefined : '이름이 비어 있다',
    sourceId: c.id,
    name: name || '(이름 없음)',
    email: email || null,
    phone: c.phone ?? c.mobile ?? null,
    title: c.title,
    memo: c.notes,
    accountId: c.account_id,
  }
}

/** 같은 도메인/이메일이 여러 건이면 CRM 유니크 제약에 걸린다 — 미리 잡는다 */
export function findDuplicateKeys<T>(rows: T[], key: (r: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // Array.from 을 쓴다 — Map 스프레드는 tsconfig 의 target 에서 downlevelIteration 을 요구한다
  return new Map(Array.from(counts.entries()).filter(([, n]) => n > 1))
}
