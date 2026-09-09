/**
 * 파이프라인 — «이 딜은 어떤 흐름을 타는가»의 목록
 *
 * **말부터 못박는다.** 딜 하나는 셋으로 이루어진다:
 *   ① **파이프라인** — 어떤 흐름인가 (GPU 인프라 · 공공 · 파트너십 …)
 *   ② **영업 단계** — 그 흐름의 어디까지 왔나 (리드 → 요구사항 파악 → 견적·제안 …)
 *   ③ **사업 유형** — 무엇을 파는 일인가 (GPU · 솔루션 · 국책 …) → `business-type.ts`
 *
 * ②는 ①에 딸려 있고 ③은 나란히 선다. 실측이 그것을 증명한다 —
 * 「공공」 파이프라인의 딜 5건이 사업 유형은 솔루션 3 · 국책 1 · 기타 1로 갈린다(2026-09-09).
 *
 * **왜 이 파일이 생겼나**(사용자 지적 2026-09-09):
 * 「영업단계가 오히려 영업단계가 아니라 파이프라인의 순서를 나는 이야기 하고 있는거자나」.
 * `/crm/process` 계열 15곳이 **파이프라인을 「영업 단계」라고 부르고** 있었다.
 * 앱의 나머지 전부(딜 만들기·딜 표·딜 상세·딜 보드·리포트 축·설정 설명문)는
 * 「파이프라인」을 쓴다 — 그러니 새 이름을 만들 것이 아니라 **틀린 자리를 고치는 것**이 맞다.
 *
 * 이 파일은 **순수 규칙**만 갖는다 — DB 도 Prisma 도 import 하지 않는다.
 * 화면(클라이언트)과 서비스(서버)가 같은 규칙을 봐야 하기 때문이다
 * (`business-type.ts` 가 같은 이유로 분리돼 있다).
 */

/** 목록에 세울 최소 정보 — 화면·서비스가 공통으로 다루는 모양 */
export interface PipelineLike {
  id: string
  name: string
  isDefault: boolean
  /** 새 딜에서 고를 수 있나(마이그 245). 접힌 것은 목록 아래로 내려간다 */
  isActive: boolean
  position: number
}

/** 이름 길이 상한 — 딜 표 칼럼·보드 머리·드롭다운에 들어가야 한다 */
export const PIPELINE_LABEL_MAX = 20

export type PipelineLabelError = 'EMPTY' | 'TOO_LONG' | 'DUPLICATE'

/** 이름 다듬기 — 앞뒤 공백과 연속 공백을 없앤다. 「GPU  인프라」와 「GPU 인프라」가 둘이 되면 안 된다 */
export function normalizePipelineName(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/** 같은 이름인가 — 대소문자·공백 차이는 같은 것으로 본다 */
export function isSamePipelineName(a: string, b: string): boolean {
  return normalizePipelineName(a).toLowerCase() === normalizePipelineName(b).toLowerCase()
}

/**
 * 새 이름이 쓸 만한가. 화면과 서버가 **같은 함수**로 판정한다 —
 * 화면만 막으면 API 로 들어오는 값이 통과하고, 서버만 막으면 사용자가 저장 눌러야 안다.
 *
 * @param existing 이미 있는 이름들(살아 있는 행만). 자기 자신은 호출부가 빼고 넘긴다
 */
export function validatePipelineName(
  raw: string | null | undefined, existing: readonly string[],
): PipelineLabelError | null {
  const name = normalizePipelineName(raw)
  if (!name) return 'EMPTY'
  if (name.length > PIPELINE_LABEL_MAX) return 'TOO_LONG'
  if (existing.some((e) => isSamePipelineName(e, name))) return 'DUPLICATE'
  return null
}

export const PIPELINE_LABEL_ERROR_TEXT: Record<PipelineLabelError, string> = {
  EMPTY: '파이프라인 이름을 입력해 주세요.',
  TOO_LONG: `파이프라인 이름은 ${PIPELINE_LABEL_MAX}자까지 넣을 수 있어요.`,
  DUPLICATE: '같은 이름의 파이프라인이 이미 있어요.',
}

/**
 * 화면에 세울 순서.
 *
 * 접은 것은 **아래로 내린다** — 지우는 게 아니라 안 보이게 하는 것이므로
 * 목록에서 사라지면 다시 켤 길이 없어진다(`sortBusinessTypes` 와 같은 규칙).
 * 기본 파이프라인은 켜진 것들 중 맨 앞이다 — 새 딜이 어디서 시작하는지 먼저 보여야 한다.
 */
export function sortPipelines<T extends PipelineLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    if (a.position !== b.position) return a.position - b.position
    return a.name.localeCompare(b.name, 'ko')
  })
}

/**
 * 딜 폼·보드가 고를 수 있는 목록.
 *
 * 켜진 것 + **지금 이 딜이 이미 쓰고 있는 것**. 뒤엣것을 빼면
 * 파이프라인을 접은 뒤 그 딜을 수정할 때 값이 조용히 날아간다
 * (`selectableBusinessTypes` 와 같은 규칙 — 같은 성격은 같은 규칙이어야 한다).
 */
export function selectablePipelines<T extends PipelineLike>(
  rows: readonly T[], currentId: string | null | undefined,
): T[] {
  return sortPipelines(rows.filter((p) => p.isActive || p.id === currentId))
}

/**
 * 새 딜이 시작할 파이프라인.
 *
 * 기본으로 지정된 것 → 없으면 켜진 것 중 첫 번째 → 그것도 없으면 아무거나.
 * **접힌 것을 기본값으로 주지 않는다** — 고를 수 없는 값이 미리 들어가 있으면
 * 사용자는 저장을 눌러 보고서야 안 되는 것을 안다.
 */
export function defaultPipelineId<T extends PipelineLike>(
  rows: readonly T[], currentId?: string | null,
): string | null {
  if (currentId && rows.some((p) => p.id === currentId)) return currentId
  const usable = selectablePipelines(rows, null)
  return usable.find((p) => p.isDefault)?.id ?? usable[0]?.id ?? rows[0]?.id ?? null
}

/* ────────────────────────────────────────────────────────────────
   단계 구성이 같은 파이프라인 찾기
   ──────────────────────────────────────────────────────────────── */

/** 지문을 만들 때 쓰는 최소 단계 정보 */
export interface StageShape {
  name: string
  kind: string
  position: number
}

/**
 * 단계 구성의 지문.
 *
 * **파이프라인을 나누는 유일한 이유는 「영업 순서가 다르다」이다.** 순서가 같으면
 * 나눌 이유가 없다 — 그건 사업 유형이 이미 하는 일이다.
 * 실측(2026-09-09): MSP · SI · 솔루션 · 컨설팅 4개가 「리드 → 상담 → 제안 → 협상 →
 * 성사 / 실패」로 **글자까지 같았다.** 그 사실을 알려면 표를 직접 뒤져야 했다.
 *
 * 이름의 앞뒤 공백만 다듬고 대소문자는 구분하지 않는다 — 「리드」와 「리드 」는 같은 단계다.
 */
export function stageSignature(stages: readonly StageShape[]): string {
  return [...stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.kind}:${normalizePipelineName(s.name).toLowerCase()}`)
    .join('|')
}

export interface PipelineWithStages extends PipelineLike {
  stages: readonly StageShape[]
}

/**
 * 파이프라인마다 «나와 단계 구성이 같은 다른 파이프라인 이름들».
 *
 * **권하지 않고 알리기만 한다.** 지우라고 하지도, 자동으로 접지도 않는다 —
 * 사업이 갈라질 계획이 있어 미리 만들어 둔 것일 수 있고, **그건 화면이 알 수 없는 사실**이다.
 * 단계가 하나도 없는 파이프라인은 세지 않는다(빈 것끼리 「같다」고 말해 봐야 뜻이 없다).
 */
export function duplicateStageGroups<T extends PipelineWithStages>(
  rows: readonly T[],
): Map<string, string[]> {
  const bySig = new Map<string, T[]>()
  for (const p of rows) {
    if (p.stages.length === 0) continue
    const sig = stageSignature(p.stages)
    const list = bySig.get(sig)
    if (list) list.push(p)
    else bySig.set(sig, [p])
  }

  // Array.from — 이 저장소의 tsc target 에서는 Map 이터레이터를 직접 순회할 수 없다
  const out = new Map<string, string[]>()
  Array.from(bySig.values()).forEach((group: T[]) => {
    if (group.length < 2) return
    group.forEach((p: T) => {
      out.set(p.id, group.filter((o: T) => o.id !== p.id).map((o: T) => o.name))
    })
  })
  return out
}

/** 배지에 쓸 한 줄 — 「MSP · SI 와 단계 구성이 같아요」 */
export function duplicateStageNote(others: readonly string[]): string | null {
  if (others.length === 0) return null
  return `${others.join(' · ')} 와 단계 구성이 같아요`
}

/* ────────────────────────────────────────────────────────────────
   단계 성사 확률
   ──────────────────────────────────────────────────────────────── */

/**
 * 성사 확률을 다듬는다.
 *
 * **비워 둘 수 있어야 한다.** 리포트는 값이 없으면 「모른다」로 정직하게 처리하는데
 * (`forecast.ts` — `rateSource: null` → `unknownTotal`), 화면이 억지로 채우게 하면
 * 사람이 **없는 숫자를 지어내게** 된다. 그래서 빈 값은 `null` 로 통과시킨다.
 *
 * 실측(2026-09-09): 리포트가 그 값을 「관리자가 정한 값」이라 부르는데
 * **정할 수 있는 화면이 앱에 0곳**이었다. MSP · SI · 솔루션 · 컨설팅 4개는
 * 시드가 값을 안 넣어서 영원히 빈칸이고, 그 파이프라인의 딜은 예상 매출에 안 잡힌다.
 *
 * @returns `undefined` = 입력이 잘못됨(저장하지 않는다) · `null` = 비움 · 숫자 = 0~100
 */
export function parseWinProbability(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return undefined
  const i = Math.round(n)
  if (i < 0 || i > 100) return undefined
  return i
}

export const WIN_PROBABILITY_ERROR_TEXT = '성사 확률은 0에서 100 사이의 숫자로 넣어 주세요.'

/**
 * 성사·실패 칸은 확률을 정하지 않는다.
 *
 * 이미 끝난 자리라 「앞으로 성사될 확률」이 뜻을 갖지 않는다 —
 * 리포트도 그 두 칸은 아예 건너뛴다(`forecast.ts`: `kind === 'WON' || 'LOST'` → continue).
 * 화면에 칸을 띄우면 채울 수 있는 것처럼 보이고, 채운 값은 아무 데도 안 쓰인다.
 */
export function canSetWinProbability(kind: string): boolean {
  return kind === 'OPEN'
}
