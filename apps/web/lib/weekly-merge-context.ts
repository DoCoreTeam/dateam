// 주간보고 취합 컨텍스트 빌더 — 순수(외부 의존 없음). gemini-refine·org-actions가 재사용, 단위테스트 대상.

export interface MergedCategoryReport {
  category: string
  performance: string
  plan: string
  issues: string
}

/** 취합 시 주입하는 지난주·기존편집 컨텍스트 — 모두 선택. 있으면 프롬프트에 블록으로 첨부된다. */
export interface MergeContext {
  /** 지난주 취합본의 구분(섹션) 목록 — 같은 의미 구분을 이 명칭으로 통일하는 기준 */
  prevCategories?: string[]
  /** 지난주 취합본의 계획 — 이번주 성과로 이행됐는지 확인용 */
  prevPlans?: { category: string; plan: string }[]
  /** 현재 저장된 취합본(부서장 편집분) — 새 취합을 이것과 주제 기준 병합·보존 */
  existingBody?: MergedCategoryReport[]
}

/** MergeContext → 프롬프트에 덧붙일 컨텍스트 블록 문자열(없으면 빈 문자열) */
export function buildMergeContextBlocks(ctx?: MergeContext): string {
  if (!ctx) return ''
  const blocks: string[] = []
  if (ctx.prevCategories && ctx.prevCategories.length > 0) {
    blocks.push(
      `\n\n## [지난주 구분 목록] (구분 통일 기준 — 최우선)\n${JSON.stringify(ctx.prevCategories)}\n` +
        `- 입력의 구분 중 위 지난주 구분과 같은 의미의 업무 영역이 있으면 **반드시 지난주 구분 명칭 그대로** 통일하세요(새 명칭 생성 지양).\n` +
        `- 지난주에 없던 새 업무만 새 구분을 만드세요.`,
    )
  }
  if (ctx.prevPlans && ctx.prevPlans.length > 0) {
    blocks.push(
      `\n\n## [지난주 계획] (성과 이행 확인)\n${JSON.stringify(ctx.prevPlans)}\n` +
        `- 위 지난주 계획 항목이 이번주 입력의 성과(performance)에서 실제 수행됐다면, 해당 구분의 성과에 그 이행 내용이 반영되도록 하세요.\n` +
        `- 지난주 계획을 임의로 삭제하지 말 것. (계속 진행 중이면 이번주 계획에도 유지)`,
    )
  }
  if (ctx.existingBody && ctx.existingBody.length > 0) {
    blocks.push(
      `\n\n## [기존 취합본/편집본] (병합·보존 — 임의 삭제 절대 금지)\n${JSON.stringify(ctx.existingBody)}\n` +
        `- 새 취합 결과를 위 기존 편집본과 **같은 주제(구분) 기준으로 병합**하세요.\n` +
        `- 기존 편집본에 있던 구분·항목은 **유지**하고, 새 입력에서 추가·갱신된 부분만 반영해 보강하세요. 기존 내용을 임의로 삭제·축소하지 마세요.\n` +
        `- 충돌 시: 기존 편집본(사람이 다듬은 값)을 우선 보존하되, 새 입력의 신규 사실은 추가하세요.`,
    )
  }
  return blocks.join('')
}
