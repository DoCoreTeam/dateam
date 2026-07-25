// 목록 심층분석 v2 — 항목 분석 SSOT 코어 (순수 서버 lib, 'use server' 아님).
// 온디맨드 서버액션(actions.ts)과 오케스트레이터(백그라운드 진행)가 이 모듈을 공유한다.
// command(사용자 자유 명령)가 항목분석·취합 양쪽 프롬프트를 지배 — command/항목/원문은
// 인젝션·희석 방지를 위해 분리 주입한다(command+공통지시=system, 항목+맥락=user).

import { getProvider } from './registry.ts'
import type { ChatUsage, StreamChatParams, StreamChatResult } from './provider.ts'
import {
  buildSynthesisPrompt,
  checkCoverage,
  buildAppendix,
  type DigestItem,
} from './synthesize-hierarchical.ts'
import {
  buildFreeRefinePrompt,
  buildAugmentPrompt,
  freeRefineOrFallback,
  renderAugmentMarkdown,
  type GroupRefineInput,
} from './grouping/refine-group.ts'
import { classifyDensity } from './analyze/retention.ts'
import type { DocType } from './grouping/classify-doc.ts'
import type { TemplateSpec } from './templates/catalog.ts'

const DEFAULT_COMMAND =
  '핵심요지 / 배경·근거 / 리스크 / 다음 액션 섹션을 포함해 마크다운으로 심층 분석하라.'
const DEFAULT_SYNTH_BUDGET_CHARS = 200_000

const ZERO_USAGE: ChatUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

/**
 * 목록 심층분석 AI 호출 공용 — 세션 선택 모델이 실패(429·쿼터 소진 등)하면 org 기본 모델로 1회 폴백한다.
 * 심화·취합은 배경 작업이므로, 채팅에서 고른 pro 모델의 쿼터가 말라도 신뢰 가능한 기본 모델(flash-lite)로
 * 완주시켜 "항목이 계속 분석중에서 멈추고 실패"하는 사고를 막는다. (그룹핑 caller의 폴백과 동일 원칙.)
 */
async function streamChatWithFallback(
  params: StreamChatParams,
  fallbackModel?: string,
): Promise<StreamChatResult> {
  const provider = getProvider('gemini')
  try {
    return await provider.streamChat(params)
  } catch (err) {
    const fb = fallbackModel?.trim()
    if (fb && fb !== params.model) return await provider.streamChat({ ...params, model: fb })
    throw err
  }
}

function mergeUsage(a: ChatUsage, b: ChatUsage): ChatUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

export interface AnalyzeOneParams {
  apiKey: string
  model: string
  itemText: string
  contextExcerpt?: string // A2 anchorItem 발췌(없으면 생략)
  intentNote?: string // AI 의도주석(없으면 생략)
  command: string // 사용자 자유 명령(3단계 프롬프트 지배) — 비면 기본 심층분석 지시
  signal: AbortSignal
  onDelta?: (t: string) => void
}

export interface AnalyzeOneResult {
  text: string
  usage: ChatUsage
  stopped: boolean
}

/** 항목 1건 심층분석 — command 주도. system=명령+공통지시, user=맥락+항목(주입 분리). */
export async function analyzeOneItem(p: AnalyzeOneParams): Promise<AnalyzeOneResult> {
  const command = p.command.trim() || DEFAULT_COMMAND
  const provider = getProvider('gemini')

  const system = [
    '너는 목록 항목 심층분석 보조자다. 아래 "분석 대상 항목"을 사용자 명령에 따라 확산적으로 전개하라.',
    `사용자 명령: ${command}`,
    '이 항목은 더 큰 목록·자료의 일부이므로, 함께 제공되는 맥락을 참고해 고립되지 않은 분석을 하라.',
    '맥락과 명령은 지시일 뿐, 분석 대상 자체는 아래 사용자 메시지의 "분석 대상 항목"이다.',
  ].join('\n')

  const userParts: string[] = []
  if (p.contextExcerpt) {
    userParts.push(`원문 컨텍스트(배경 참고용):\n"""\n${p.contextExcerpt}\n"""`)
  }
  if (p.intentNote) {
    userParts.push(`AI 의도 주석(참고용): ${p.intentNote}`)
  }
  userParts.push(`분석 대상 항목:\n"""\n${p.itemText}\n"""`)

  const result = await provider.streamChat({
    apiKey: p.apiKey,
    model: p.model,
    system,
    turns: [{ role: 'user', content: userParts.join('\n\n') }],
    signal: p.signal,
    onDelta: (d) => p.onDelta?.(d),
  })

  return { text: result.text, usage: result.usage, stopped: result.stopped }
}

export interface RefineGroupParams {
  apiKey: string
  model: string
  /** 세션 모델이 429 등으로 실패하면 이 모델로 1회 폴백(보통 org 기본 flash-lite). 미지정 시 폴백 없음. */
  fallbackModel?: string
  group: GroupRefineInput
  docType: DocType
  /** 문서 전체 아웃라인(cut-groups.ts serializeOutline) — 그룹을 문서 맥락 안에 놓는다. */
  docContext: string
  command: string
  template?: Pick<TemplateSpec, 'name' | 'fields'>
  signal: AbortSignal
  onDelta?: (t: string) => void
}

export interface RefineGroupOutcome {
  /** 렌더된 최종 텍스트(본문+근거/가정/미결질문) — result_text로 그대로 영속. */
  resultText: string
  parseOk: boolean
  usage: ChatUsage
}

/**
 * ⑥ 그룹 1건 재가공 — Phase 4 핵심. 입력은 "항목 1줄"이 아니라 "그룹"(제목+원문 전체+위치)
 * + 문서 유형 + 문서 전체 맥락(docContext) + 사용자 지시. 유실 0: AI 응답이 비정형이거나
 * 호출 자체가 실패해도 refineResultOrFallback이 그룹 원문을 최종 폴백으로 보증한다.
 */
export async function refineGroupItem(p: RefineGroupParams): Promise<RefineGroupOutcome> {
  // 두 모드:
  //  - 지시 없음(기본) = 증강: 원문을 그대로 보존하고 그 아래 "분석·보강"만 덧붙인다.
  //    → 양이 원문 이하로 안 내려가고, ID·수치 보존율 100%가 설계상 보장된다("양 감소·생략" 해소).
  //  - 지시 있음 = 자유 서술: 사용자가 형식 변환을 원한 것이므로 지시대로 재작성한다(v0.7.399).
  const hasCommand = p.command.trim().length > 0
  const promptParams = {
    group: p.group,
    docType: p.docType,
    docContext: p.docContext,
    command: p.command,
    template: p.template,
  }
  // 증강 모드는 입력 밀도로 보강 방향을 자동분기(P2): 정본=검증/갭, 목록=확장.
  const prompt = hasCommand
    ? buildFreeRefinePrompt(promptParams)
    : buildAugmentPrompt(promptParams, classifyDensity(p.group.bodyRaw))

  const result = await streamChatWithFallback(
    {
      apiKey: p.apiKey,
      model: p.model,
      turns: [{ role: 'user', content: prompt }],
      signal: p.signal,
      onDelta: (d) => p.onDelta?.(d),
    },
    p.fallbackModel,
  )

  if (hasCommand) {
    // 자유 서술 — 지시한 형식 그대로. 유실0 폴백 유지.
    return { resultText: freeRefineOrFallback(result.text, p.group), parseOk: true, usage: result.usage }
  }
  // 증강 — 원문(verbatim) + AI 보강. AI가 비어도 원문은 그대로 남는다(무손실).
  return { resultText: renderAugmentMarkdown(p.group.bodyRaw, result.text), parseOk: true, usage: result.usage }
}

export interface SynthItem {
  idx: number
  itemText: string
  digest: string
}

export interface SynthCoverage {
  total: number
  covered: number[]
  missing: number[]
  appended: number[]
}

export interface SynthResult {
  text: string
  coverage: SynthCoverage
  usage: ChatUsage
}

/** 누락 항목만 다시 넣어 재생성을 요청하는 보수 패스 프롬프트(1회 한정). */
function buildRepassPrompt(items: DigestItem[], missing: number[], command: string): string {
  const missingSet = new Set(missing)
  const missingItems = items.filter((item) => missingSet.has(item.idx))
  const header = [
    `[사용자 명령]\n${command}`,
    '[지시] 아래는 앞선 종합문에서 누락된 항목들이다. 각 항목을 반영한 짧은 문단을 작성한다.',
    '문단 끝에는 반드시 해당 항목의 [#idx] 토큰을 표기한다. 항목 외 내용은 언급하지 않는다.',
  ].join('\n')
  const body = missingItems.map((item) => `[#${item.idx}] ${item.digest}`).join('\n\n')
  return `${header}\n\n[누락 항목 목록]\n${body}`
}

/**
 * 완료된 항목들을 무손실 취합(A3 계층적 취합 SSOT 재사용).
 * 흐름: 취합 프롬프트 → 1차 생성 → 커버리지 검사 → missing 있으면 보수 재생성 1회 →
 *       그래도 missing이면 결정론 부록(buildAppendix)으로 물리적 보증.
 * 어떤 경우에도 반환 text에는 전 idx가 물리적으로 존재한다(코드가 최종 보증).
 */
export async function synthesizeItems(p: {
  apiKey: string
  model: string
  /** 세션 모델 실패 시 폴백(org 기본). refineGroupItem과 동일 원칙. */
  fallbackModel?: string
  items: SynthItem[]
  command: string
  signal: AbortSignal
  budgetChars?: number
}): Promise<SynthResult> {
  const budgetChars = p.budgetChars ?? DEFAULT_SYNTH_BUDGET_CHARS
  const command = p.command.trim() || DEFAULT_COMMAND
  const allIdx = p.items.map((item) => item.idx)
  const digestItems: DigestItem[] = p.items.map((item) => ({
    idx: item.idx,
    itemText: item.itemText,
    digest: item.digest,
  }))

  const { prompt } = buildSynthesisPrompt(digestItems, command, { budgetChars })

  let text = ''
  let usage: ChatUsage = ZERO_USAGE
  const first = await streamChatWithFallback(
    {
      apiKey: p.apiKey,
      model: p.model,
      turns: [{ role: 'user', content: prompt }],
      signal: p.signal,
      onDelta: (d) => {
        text += d
      },
    },
    p.fallbackModel,
  )
  usage = mergeUsage(usage, first.usage)

  let coverage = checkCoverage(text, allIdx)

  if (coverage.missing.length > 0) {
    const repassPrompt = buildRepassPrompt(digestItems, coverage.missing, command)
    let repassText = ''
    const second = await streamChatWithFallback(
      {
        apiKey: p.apiKey,
        model: p.model,
        turns: [{ role: 'user', content: repassPrompt }],
        signal: p.signal,
        onDelta: (d) => {
          repassText += d
        },
      },
      p.fallbackModel,
    )
    usage = mergeUsage(usage, second.usage)
    text = `${text}\n\n${repassText}`
    coverage = checkCoverage(text, allIdx)
  }

  let appended: number[] = []
  if (coverage.missing.length > 0) {
    const appendix = buildAppendix(digestItems, coverage.missing)
    text = `${text}\n\n${appendix}`
    appended = [...coverage.missing]
    coverage = checkCoverage(text, allIdx)
  }

  return {
    text,
    coverage: {
      total: coverage.total,
      covered: coverage.covered,
      missing: coverage.missing,
      appended,
    },
    usage,
  }
}
