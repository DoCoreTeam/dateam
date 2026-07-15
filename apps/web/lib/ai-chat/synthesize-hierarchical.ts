// 계층적 취합(무손실 완성형) — 결정론 파트 SSOT (순수 함수, 단위테스트 대상).
// 핵심 계약(유실0): AI가 종합문을 생성하되, 모든 항목이 물리적으로 존재함을
// 이 모듈의 코드가 최종 보증한다. AI 호출은 이 모듈에 없다(순수).
// 4개 함수: (1)취합 프롬프트 빌더 (2)커버리지 검사 (3)누락 부록 빌더 (4)패치 적용.

export interface DigestItem {
  idx: number
  itemText: string
  digest: string
}

/** [#idx] 토큰 생성 규칙 — 프롬프트·커버리지·부록·패치가 전부 이 포맷을 공유(SSOT). */
function idxToken(idx: number): string {
  return `[#${idx}]`
}

/**
 * 취합 프롬프트 빌더. 각 항목 다이제스트에 반드시 [#idx] 토큰을 강제.
 * budgetChars 초과 시 그룹 collapse(항목들을 묶어 요약 다이제스트로 압축)하되
 * [#idx] 토큰은 전부 보존한다. command(사용자 명령)가 종합 목적을 지배.
 */
export function buildSynthesisPrompt(
  items: DigestItem[],
  command: string,
  opts: { budgetChars: number }
): { prompt: string; collapsed: boolean } {
  const header = [
    `[사용자 명령]\n${command}`,
    '[지시] 아래 항목을 생략 없이 전부 반영해 하나의 종합문으로 작성한다.',
    '흐름상 이상한 것만 자연스럽게 교정하고, 내용을 임의로 축약·삭제하지 않는다.',
    '각 항목을 반영한 문단 끝에는 반드시 해당 항목의 [#idx] 토큰을 표기한다.',
  ].join('\n')

  const fullBody = items.map((item) => `${idxToken(item.idx)} ${item.digest}`).join('\n\n')
  const fullPrompt = `${header}\n\n[항목 목록]\n${fullBody}`

  if (fullPrompt.length <= opts.budgetChars) {
    return { prompt: fullPrompt, collapsed: false }
  }

  const collapsedBody = buildCollapsedBody(items, header.length, opts.budgetChars)
  const collapsedPrompt = `${header}\n\n[항목 목록 — 그룹 압축됨]\n${collapsedBody}`
  return { prompt: collapsedPrompt, collapsed: true }
}

/**
 * budget 초과 시 항목을 그룹으로 묶어 요약 다이제스트로 압축한다.
 * 압축은 다이제스트 문자열만 줄이며, [#idx] 토큰은 그룹 내 전 항목分 그대로 나열해 보존한다.
 */
function buildCollapsedBody(items: DigestItem[], headerLen: number, budgetChars: number): string {
  const available = Math.max(budgetChars - headerLen - 64, items.length * 8)
  const perItemBudget = Math.max(Math.floor(available / Math.max(items.length, 1)), 20)

  const groupSize = 3
  const lines: string[] = []
  for (let i = 0; i < items.length; i += groupSize) {
    const group = items.slice(i, i + groupSize)
    const tokens = group.map((g) => idxToken(g.idx)).join(' ')
    const summary = group
      .map((g) => truncateDigest(g.digest, perItemBudget))
      .join(' / ')
    lines.push(`${tokens} ${summary}`)
  }
  return lines.join('\n')
}

function truncateDigest(digest: string, maxLen: number): string {
  if (digest.length <= maxLen) return digest
  if (maxLen <= 1) return digest.slice(0, maxLen)
  return `${digest.slice(0, maxLen - 1)}…`
}

export interface CoverageReport {
  total: number
  covered: number[]
  missing: number[]
}

/** synthOutput에서 [#idx] 토큰을 스캔해 전체 idx 대비 covered/missing 판정. */
export function checkCoverage(synthOutput: string, allIdx: number[]): CoverageReport {
  const foundIdx = new Set<number>()
  const tokenRe = /\[#(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(synthOutput)) !== null) {
    foundIdx.add(Number(match[1]))
  }

  const covered: number[] = []
  const missing: number[] = []
  for (const idx of allIdx) {
    if (foundIdx.has(idx)) covered.push(idx)
    else missing.push(idx)
  }

  return { total: allIdx.length, covered, missing }
}

/**
 * missing 항목을 결정론 마크다운 부록으로. 어떤 경우에도 전 항목이 물리적으로
 * 존재하게 만드는 안전망 — AI가 놓친 항목을 원문 그대로 복구한다.
 */
export function buildAppendix(items: DigestItem[], missing: number[]): string {
  if (missing.length === 0) return ''

  const missingSet = new Set(missing)
  const missingItems = items.filter((item) => missingSet.has(item.idx))

  const lines = ['## 누락 항목 복구 (자동 부록)', '']
  for (const item of missingItems) {
    lines.push(`### ${idxToken(item.idx)}`)
    lines.push(`- 원문: ${item.itemText}`)
    lines.push(`- 요약: ${item.digest}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export interface Patch {
  idx: number
  replacement: string
}

/**
 * @reserved v2.1 교정패스 — idx 단위 패치 적용, 현재 미배선(호출부 없음, 단위테스트만 존재).
 * idx 단위 패치만 적용(비패치 구간 무변경 = 무왜곡 증명).
 * [#idx] 토큰이 포함된 문단(빈 줄로 구분된 블록)을 replacement로 교체.
 * 존재하지 않는 idx의 패치는 무시(안전) — 어떤 문단도 잘못 건드리지 않는다.
 */
export function applyPatches(synthOutput: string, patches: Patch[]): string {
  const patchByIdx = new Map<number, string>()
  for (const p of patches) patchByIdx.set(p.idx, p.replacement)

  const paragraphs = synthOutput.split(/\n\n/)
  const patchedParagraphs = paragraphs.map((para) => {
    const tokenRe = /\[#(\d+)\]/g
    let match: RegExpExecArray | null
    let targetIdx: number | undefined
    while ((match = tokenRe.exec(para)) !== null) {
      const idx = Number(match[1])
      if (patchByIdx.has(idx)) {
        targetIdx = idx
        break
      }
    }
    if (targetIdx === undefined) return para
    return patchByIdx.get(targetIdx) as string
  })

  return patchedParagraphs.join('\n\n')
}
