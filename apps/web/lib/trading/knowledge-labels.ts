/**
 * 지식 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

import type { KnowledgeRow } from './overview-shape.ts'

export const KNOWLEDGE_KIND_LABEL: Record<KnowledgeRow['kind'], string> = {
  card: '지식 카드',
  source: '자료 분석',
  report: '패턴 리포트',
  proposal: '설정 제안',
  explanation: '신호 설명',
}
