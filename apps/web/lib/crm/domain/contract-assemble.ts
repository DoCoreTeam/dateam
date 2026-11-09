/**
 * 계약서 조립 — 모듈들 → 조항 배열 (P0184 I06)
 *
 * **순서는 데이터가 정한다.** 모듈의 position 순으로 늘어놓는다. 공통 조항을 앞(목적 정의)과
 * 뒤(비밀유지 … 준거법) 두 모듈로 두고 그 사이에 급부 대가 규제를 끼우는 것이 보통의 모양이다.
 * 부속서만 늘 맨 뒤에 붙고 조 번호 밖에서 따로 센다.
 *
 * **같은 조항은 한 번.** 물품 + SW 사용권 + 유지보수를 함께 고르면 「검수」 같은 조항이 겹친다.
 * 먼저 나온 자리에 한 번만 둔다.
 *
 * **본문이 없으면 조립하지 않는다.** 승인본이 없는 키를 빈칸으로 두고 넘어가면 조항이 빠진
 * 계약서가 아무 말 없이 만들어진다. 빠진 키를 모아 돌려주고, 부르는 쪽이 거절한다.
 */

import type { Clause } from './contract-body.ts'
import type { ContractModule, ModuleKindOrCommon } from './contract-module.ts'
import { assembledAnnexTitle, assembledArticleTitle } from '../../terms/contract-doc.ts'

/** 조항 라이브러리에서 읽은 본문 (승인본) */
export interface ClauseText {
  title: string
  html: string
}

export interface AssembleResult {
  clauses: Clause[]
  /** 본문이 없는 조항 키 — 하나라도 있으면 부르는 쪽이 거절한다 */
  missing: string[]
}

const KIND_RANK: Record<ModuleKindOrCommon, number> = { COMMON: 0, PERFORMANCE: 1, CONSIDERATION: 2, REGULATION: 3, ANNEX: 4 }

/** 「제5조 (비밀유지)」로 저장된 제목에서 번호를 떼어 낸다 — 번호는 조립이 매긴다 */
export function bareTitle(title: string): string {
  const t = title.trim()
  const m = t.match(/^제\s*\d+\s*조\s*\((.*)\)\s*$/)
  if (m) return m[1].trim()
  return t.replace(/^제\s*\d+\s*조\s*/, '').trim()
}

/** 조항 id 는 [\w-] 만 받는다(contract-body). 키의 점을 줄표로 바꾼다 */
export const clauseIdOf = (key: string): string => key.replace(/[^\w-]/g, '-').slice(0, 64)

function ordered(modules: readonly ContractModule[]): ContractModule[] {
  return [...modules].sort((a, b) => {
    const annex = Number(a.kind === 'ANNEX') - Number(b.kind === 'ANNEX')
    if (annex !== 0) return annex
    if (a.position !== b.position) return a.position - b.position
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind]
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

export function assembleContract(modules: readonly ContractModule[], texts: ReadonlyMap<string, ClauseText>): AssembleResult {
  const seen = new Set<string>()
  const missing: string[] = []
  const picked: { key: string; annex: boolean; text: ClauseText }[] = []
  for (const m of ordered(modules)) {
    for (const key of m.clauseKeys) {
      if (seen.has(key)) continue
      seen.add(key)
      const text = texts.get(key)
      if (!text) { missing.push(key); continue }
      picked.push({ key, annex: m.kind === 'ANNEX', text })
    }
  }
  let article = 0
  let annex = 0
  const ids = new Set<string>()
  const clauses = picked.map(({ key, annex: isAnnex, text }) => {
    const title = isAnnex ? assembledAnnexTitle(++annex, bareTitle(text.title)) : assembledArticleTitle(++article, bareTitle(text.title))
    // a.b 와 a-b 는 같은 id 가 된다 — 겹치면 뒤에 번호를 붙인다 (조항 id 가 겹치면 저장이 거절된다)
    let id = clauseIdOf(key)
    for (let n = 2; ids.has(id); n++) id = `${clauseIdOf(key).slice(0, 60)}-${n}`
    ids.add(id)
    return { id, title, html: text.html, origin: 'template' as const }
  })
  return { clauses, missing }
}
