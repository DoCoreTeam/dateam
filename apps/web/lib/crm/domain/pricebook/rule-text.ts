/**
 * 규칙 한 줄을 사람이 읽는 문장으로 — 제품 상세의 규칙 탭과 할인 탭이 쓴다
 *
 * 규칙은 품목 id 로 저장된다. 화면은 이름으로 읽어야 하므로 이름표를 받아 바꾼다.
 * 없는 품목을 가리키면 그 사실을 문장에 그대로 적는다 — 조용히 빈칸으로 두지 않는다.
 */

import type { PriceRule } from './types.ts'
import { COMPANY_KIND_LABEL } from '../company-kind.ts'

const VAR_TEXT: Record<string, string> = {
  'gpu.dc': '데이터센터 GPU 장수',
  'gpu.ws': '워크스테이션과 데스크톱 GPU 장수',
  'gpu.timed': '지정 시간 GPU 장수',
  'gpu.total': 'GPU 합계',
  nodes: '노드 수',
  training: '추가 교육 횟수',
}

const CLASS_TEXT: Record<string, string> = { DC: '데이터센터용', WS: '워크스테이션용', CONSUMER: '데스크톱용', NPU: 'NPU' }

export function describeRule(rule: PriceRule, nameOf: (id: string) => string | null): string {
  const n = (id: string) => nameOf(id) ?? `없는 품목(${id})`
  const list = (ids: readonly string[]) => ids.map(n).join(', ')
  switch (rule.kind) {
    case 'ONE_OF': return `${list(rule.items)} 가운데 하나만 고른다`
    case 'WITH': return `${n(rule.item)}을 고르면 ${list(rule.with)}이 같이 들어간다`
    case 'INCLUDES':
      if (rule.varKey) return `${n(rule.item)}은 ${VAR_TEXT[rule.varKey] ?? rule.varKey} ${rule.qty ?? 0}을 기본 포함한다`
      return `${n(rule.item)}은 ${list(rule.items ?? [])}을 기본 포함한다(0원)`
    case 'QTY_FROM':
      return rule.minusIncluded
        ? `${n(rule.item)} 수량은 ${VAR_TEXT[rule.varKey] ?? rule.varKey}에서 기본 포함을 뺀 값`
        : `${n(rule.item)} 수량은 ${VAR_TEXT[rule.varKey] ?? rule.varKey}를 따라간다`
    case 'CAP': return `${n(rule.item)}은 ${VAR_TEXT[rule.varKey] ?? rule.varKey} ${rule.max.toLocaleString('ko-KR')}까지`
    case 'ELIGIBLE': return `${n(rule.item)}은 ${rule.classes.map((c) => CLASS_TEXT[c] ?? c).join(', ')} GPU 만 고를 수 있다`
    case 'DISCOUNT': {
      const who = rule.companyKind === 'partner' ? '판매 경로가 파트너' : `기관 종류가 ${COMPANY_KIND_LABEL[rule.companyKind] ?? rule.companyKind}`
      return `${who}이면 할인 대상 품목에 ${rule.label} ${rule.pct}%${rule.confirmed ? '' : ' (제안값)'}`
    }
    case 'SCALE_CAP':
      return `${rule.section} 정가 소계가 ${VAR_TEXT[rule.varKey] ?? rule.varKey} × ${Number(rule.perUnitMinor).toLocaleString('ko-KR')}원을 넘으면 넘는 만큼 할인`
  }
}
