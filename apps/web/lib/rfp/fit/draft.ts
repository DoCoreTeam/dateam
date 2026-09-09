/**
 * 프로필 자동 초안 (설계서 3.10.2)
 *
 * ## 프로필 입력이 무거우면 아무도 안 쓴다
 *
 * 「회사 정보를 다 입력하세요」로 시작하는 기능은 첫 화면에서 버려진다.
 * 회사소개서와 사업자등록증은 **이미 갖고 있는 문서**다. 그걸 올리면 대부분이 채워진다.
 *
 * ## 파이프라인을 새로 만들지 않는다
 *
 * 파싱·구조화는 이미 있다. 프로필 초안은 **같은 IR 위에서 값만 다르게 뽑는 것**이다.
 * 여기에 별도 파서를 만들면 형식이 하나 늘 때마다 두 곳을 고쳐야 한다.
 *
 * ## 초안은 확정이 아니다
 *
 * 자동으로 뽑은 값이 틀린 채 판정에 쓰이면, 부적합의 이유가 «우리 회사 정보가 틀려서» 가 되고
 * 사용자는 그것을 영영 모른다. 그래서 초안은 `draft` 로만 저장되고,
 * 판정은 `active` 프로필만 쓴다.
 */

import type { IrDocument } from '../ir/types.ts'
import type { CompanyProfile, Certification, TrackRecord } from './profile.ts'
import { emptyProfile, parseAmount } from './profile.ts'

/** 초안에 붙는 근거 — 어느 블록에서 뽑았는지 */
export interface DraftEvidence {
  field: string
  blockId: string
  quote: string
}

export interface ProfileDraft {
  profile: CompanyProfile
  evidence: DraftEvidence[]
  /** 못 뽑은 칸 — 화면이 여기부터 물어본다 */
  missing: string[]
}

const BIZ_NO_RE = /\b\d{3}-\d{2}-\d{5}\b/
const CAPITAL_RE = /자본금[^0-9]{0,10}([0-9,]+\s*(?:억|만)?원?)/
const REVENUE_RE = /(매출액?|연간\s*매출)[^0-9]{0,10}([0-9,]+\s*(?:억|만)?원?)/
const HEADCOUNT_RE = /(임직원|직원|인원)\s*수?[^0-9]{0,6}([0-9,]+)\s*명/
const REGION_RE = /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원(?:특별자치)?도|충청북도|충청남도|전라북도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)/

/** 인증 이름으로 알아보는 것들 */
const CERT_NAMES = [
  'ISO 27001', 'ISO 9001', 'ISO 14001', 'CSAP', 'GS인증', 'CMMI',
  'ISMS', 'ISMS-P', '벤처기업', '이노비즈', '메인비즈', '기업부설연구소',
]

/**
 * 문서에서 프로필 초안을 만든다.
 *
 * 값마다 근거 블록을 남긴다 — 「자본금이 왜 10억이지」를 사용자가 확인할 수 있어야
 * 확인·수정이 실제로 이뤄진다.
 */
export function draftProfile(docs: readonly IrDocument[], version = 1): ProfileDraft {
  const profile = emptyProfile(version)
  const evidence: DraftEvidence[] = []

  const blocks = docs.flatMap((d) => d.blocks)
  const tables = docs.flatMap((d) => d.tables)

  for (const b of blocks) {
    const text = b.text
    if (!text.trim()) continue

    if (!profile.basic.businessNumber) {
      const m = text.match(BIZ_NO_RE)
      if (m) {
        profile.basic.businessNumber = m[0]
        evidence.push({ field: 'basic.businessNumber', blockId: b.blockId, quote: trim(text) })
      }
    }
    if (profile.basic.capitalKrw === null) {
      const m = text.match(CAPITAL_RE)
      const amount = m ? parseAmount(m[1]) : null
      if (amount !== null) {
        profile.basic.capitalKrw = amount
        evidence.push({ field: 'basic.capitalKrw', blockId: b.blockId, quote: trim(text) })
      }
    }
    if (profile.basic.annualRevenueKrw === null) {
      const m = text.match(REVENUE_RE)
      const amount = m ? parseAmount(m[2]) : null
      if (amount !== null) {
        profile.basic.annualRevenueKrw = amount
        evidence.push({ field: 'basic.annualRevenueKrw', blockId: b.blockId, quote: trim(text) })
      }
    }
    if (profile.basic.headcount === null) {
      const m = text.match(HEADCOUNT_RE)
      if (m) {
        profile.basic.headcount = Number(m[2].replace(/,/g, ''))
        evidence.push({ field: 'basic.headcount', blockId: b.blockId, quote: trim(text) })
      }
    }
    if (!profile.basic.region) {
      const m = text.match(REGION_RE)
      if (m) {
        profile.basic.region = m[1]
        evidence.push({ field: 'basic.region', blockId: b.blockId, quote: trim(text) })
      }
    }
    if (/소프트웨어사업자\s*신고/.test(text) && !profile.basic.registrations.includes('소프트웨어사업자 신고')) {
      profile.basic.registrations.push('소프트웨어사업자 신고')
      evidence.push({ field: 'basic.registrations', blockId: b.blockId, quote: trim(text) })
    }

    for (const name of matchedCerts(text)) {
      if (profile.certifications.some((c) => c.name === name)) continue
      profile.certifications.push({ name, issuer: null, validUntil: null })
      evidence.push({ field: 'certifications', blockId: b.blockId, quote: trim(text) })
    }
  }

  // 실적은 표에 있다. 문장으로 흩어진 실적은 사람이 넣는 편이 빠르다
  for (const t of tables) {
    const records = tableToRecords(t.cells, t.rows, t.cols)
    for (const r of records) {
      if (profile.trackRecords.some((x) => x.projectName === r.projectName)) continue
      profile.trackRecords.push(r)
      evidence.push({ field: 'trackRecords', blockId: t.blockId, quote: r.projectName })
    }
  }

  return { profile, evidence, missing: findMissing(profile) }
}

/**
 * 이 글에 있는 인증 이름들.
 *
 * 긴 이름이 이긴다 — 「ISMS-P」 를 찾으면 그 안에 든 「ISMS」 는 세지 않는다.
 * 안 그러면 인증 하나가 둘로 늘고, 그 숫자로 자격을 판정한다.
 */
export function matchedCerts(text: string): string[] {
  const flat = text.replace(/\s/g, '')
  const hits = CERT_NAMES.filter((n) => flat.includes(n.replace(/\s/g, '')))
  return hits.filter((n) => !hits.some((other) => other !== n && other.includes(n)))
}

function trim(s: string): string {
  return s.trim().slice(0, 200)
}

interface Cell { r: number; c: number; text: string }

/** 실적표를 실적으로 옮긴다 — 머리글에 사업명이 있어야 표로 본다 */
export function tableToRecords(cells: readonly Cell[], rows: number, cols: number): TrackRecord[] {
  const grid: string[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
  for (const c of cells) {
    if (c.r < rows && c.c < cols) grid[c.r][c.c] = c.text.trim()
  }
  if (grid.length < 2) return []

  const header = grid[0].map((h) => h.replace(/\s/g, ''))
  const nameCol = header.findIndex((h) => /사업명|과업명|프로젝트|계약명/.test(h))
  if (nameCol < 0) return []

  const clientCol = header.findIndex((h) => /발주처|발주기관|고객사|수요기관/.test(h))
  const amountCol = header.findIndex((h) => /금액|계약금액|사업비/.test(h))
  const startCol = header.findIndex((h) => /시작|착수/.test(h))
  const endCol = header.findIndex((h) => /종료|완료|준공/.test(h))

  const out: TrackRecord[] = []
  for (let r = 1; r < grid.length; r++) {
    const name = grid[r][nameCol]
    if (!name) continue
    out.push({
      projectName: name,
      client: clientCol >= 0 ? grid[r][clientCol] || null : null,
      amountKrw: amountCol >= 0 ? parseAmount(grid[r][amountCol]) : null,
      startDate: startCol >= 0 ? toIso(grid[r][startCol]) : null,
      endDate: endCol >= 0 ? toIso(grid[r][endCol]) : null,
      domainTags: [],
    })
  }
  return out
}

/** 「2024.03.01」 「2024-03-01」 「2024년 3월」 을 ISO 로 */
export function toIso(raw: string): string | null {
  if (!raw) return null
  const t = raw.replace(/\s/g, '')
  const ymd = t.match(/(\d{4})[.\-/년](\d{1,2})[.\-/월]?(\d{1,2})?/)
  if (!ymd) return null
  const y = ymd[1]
  const m = String(Number(ymd[2])).padStart(2, '0')
  const d = ymd[3] ? String(Number(ymd[3])).padStart(2, '0') : '01'
  return `${y}-${m}-${d}`
}

/** 못 뽑은 칸 — 화면이 여기부터 물어본다 */
function findMissing(p: CompanyProfile): string[] {
  const missing: string[] = []
  if (!p.basic.companyName) missing.push('basic.companyName')
  if (!p.basic.businessNumber) missing.push('basic.businessNumber')
  if (p.basic.capitalKrw === null) missing.push('basic.capitalKrw')
  if (p.basic.annualRevenueKrw === null) missing.push('basic.annualRevenueKrw')
  if (p.basic.headcount === null) missing.push('basic.headcount')
  if (!p.basic.region) missing.push('basic.region')
  if (p.trackRecords.length === 0) missing.push('trackRecords')
  return missing
}

/**
 * 초안은 draft 로만 저장된다.
 *
 * 자동으로 뽑은 값이 틀린 채 판정에 쓰이면 부적합의 이유가 «우리 회사 정보가 틀려서» 가 되고
 * 사용자는 그것을 영영 모른다.
 */
export function isUsableForAssessment(profile: CompanyProfile): boolean {
  return profile.status === 'active'
}

/** 사용자가 확인하면 활성으로 바꾼다 — 이름이 없으면 확정할 수 없다 */
export function confirmDraft(profile: CompanyProfile): CompanyProfile {
  if (!profile.basic.companyName.trim()) {
    throw new Error('회사 이름 없이 프로필을 확정할 수 없다')
  }
  return { ...profile, status: 'active' }
}
