/**
 * 시험 글과 시험 품목 목록 — 기획서 「화면」 절의 숙명여대 글 두 벌
 *
 * 규칙 해석기, 조립, 창구 시험이 같은 한 벌을 쓴다. 따로 적으면 언젠가 갈린다.
 */

import { GCUBE_EDGE } from '../pricebook/gcube-edge.ts'
import type { Catalog } from './read-rules.ts'

export const SOOKMYUNG_SENTENCE = '숙명여대 교수 연구용이야. gcube 크레딧 2억 8천, EDGE 표준형에 H100 4장, SSO랑 정산 연동 개발 2 M/M 고급으로.'

export const SOOKMYUNG_LINES = [
  '숙명여대 교수 연구용',
  '크레딧 2.8억',
  'EDGE 표준형, H100 4장, 6000 Ada 6장',
  '노드는 30대 정도',
  'SSO 정산 연동 고급 2MM',
  '설치는 우리가 다 해줌',
].join('\n')

export const TEST_CATALOG: Catalog = {
  products: [{ id: GCUBE_EDGE.id, name: GCUBE_EDGE.name, items: GCUBE_EDGE.items.map((i) => ({ id: i.id, name: i.name, aliases: [] })) }],
  items: [{ id: 'credit', name: 'gcube 크레딧', aliases: ['크레딧'] }],
}
