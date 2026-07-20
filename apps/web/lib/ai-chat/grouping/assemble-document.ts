// ⑦ 정합 패스 + 결정론 조립 — 그룹별 재가공(⑥) 결과를 완성 문서(markdown)로 결정론 조립한다.
// 핵심 보증: 전달된 outcome이 전부 물리적으로 문서에 존재한다(AI 없이 코드가 순회 — 누락 0).
// 실패(error) 그룹은 "## 확인 필요" 섹션으로 비차단 노출한다(조용한 드롭 금지).
//
// 최종 크리틱(정합 패스)은 buildCriticPrompt로 호출측(worker)이 비차단 1회 실행 — 실패해도 문서는 이미 완성돼 있다.

export interface GroupRefineOutcome {
  idx: number
  treePath: string
  title: string
  depth: number
  status: 'done' | 'error'
  /** status='done'일 때 renderRefineMarkdown 등으로 렌더된 최종 텍스트. */
  resultText?: string
  /** status='error'일 때 실패 사유(사용자에게 명시 노출 — 조용한 드롭 금지). */
  errorText?: string
}

export interface MissingGroup {
  idx: number
  title: string
  treePath: string
  reason: string
}

export interface AssembledDocumentResult {
  markdown: string
  /** 결과가 없는(error) 그룹 — 항상 "확인 필요" 섹션에도 나타난다. */
  missingGroups: MissingGroup[]
  groupCount: number
}

function headingPrefix(depth: number): string {
  // depth 0 → "##", 이후 depth당 한 단계 깊어지되 "######"(h6)을 넘지 않는다.
  const level = Math.min(6, 2 + Math.max(0, depth))
  return '#'.repeat(level)
}

/**
 * 그룹 재가공 결과들 → 완성 문서(markdown). idx 순 정렬은 호출측 책임(이미 정렬돼 들어온다고 가정하되
 * 여기서도 방어적으로 재정렬해 순서 의존 버그를 막는다).
 */
export function assembleDocument(
  docTitle: string,
  outcomes: readonly GroupRefineOutcome[],
): AssembledDocumentResult {
  const sorted = [...outcomes].sort((a, b) => a.idx - b.idx)
  const bodyBlocks: string[] = []
  const missingGroups: MissingGroup[] = []

  for (const o of sorted) {
    const heading = `${headingPrefix(o.depth)} ${o.treePath}. ${o.title}`
    if (o.status === 'done' && (o.resultText ?? '').trim()) {
      bodyBlocks.push(`${heading}\n\n${(o.resultText ?? '').trim()}`)
    } else {
      const reason = o.errorText?.trim() || '재가공 결과가 없습니다'
      bodyBlocks.push(`${heading}\n\n_(확인 필요 — ${reason})_`)
      missingGroups.push({ idx: o.idx, title: o.title, treePath: o.treePath, reason })
    }
  }

  const parts = [`# ${docTitle}`]
  if (bodyBlocks.length === 0) {
    parts.push('', '_(그룹이 없습니다)_')
  } else {
    parts.push('', ...bodyBlocks.map((b) => `${b}\n`))
  }

  if (missingGroups.length > 0) {
    parts.push(
      '## 확인 필요',
      '아래 그룹은 재가공에 실패했거나 결과가 비어 있습니다. 원본 그룹으로 돌아가 확인해주세요.',
      '',
      ...missingGroups.map((m) => `- (${m.treePath}) ${m.title} — ${m.reason}`),
    )
  }

  return { markdown: parts.join('\n'), missingGroups, groupCount: sorted.length }
}

/**
 * 조립 문서가 사용자 지시를 만족하는지 자가검증하는 크리틱 프롬프트(순수).
 * worker가 비차단 1회 실행 → 성공하면 "## 검토 노트"로 append, 실패해도 문서는 그대로 유효.
 */
export function buildCriticPrompt(docTitle: string, command: string, doc: string): string {
  return (
    `아래는 "${docTitle}" 문서다. 사용자 지시를 이 문서가 잘 만족하는지 짧게 검토하라.\n` +
    (command.trim() ? `사용자 지시: ${command.trim()}\n` : '') +
    '- 빠졌거나 약한 부분, 서로 모순되는 그룹, 근거 없이 단정한 부분을 3~5개 불릿으로만.\n' +
    '- 문서를 다시 쓰지 말 것. 검토 코멘트만.\n\n' +
    `문서:\n"""\n${doc.slice(0, 12_000)}\n"""`
  )
}

/** 크리틱 응답을 "## 검토 노트" 섹션으로 append(비차단 — raw가 비어도 문서는 그대로 반환). */
export function appendCriticNotes(doc: string, criticRaw: string): string {
  const note = criticRaw.trim()
  if (!note) return doc
  return `${doc}\n\n## 검토 노트\n${note}`
}
