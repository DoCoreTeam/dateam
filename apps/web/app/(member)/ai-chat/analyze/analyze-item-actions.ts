'use server'

// 목록 심층분석 — 항목별 심층분석(analyzeItem)·cross-item 종합(synthesizeInsights) 서버 액션.
// actions.ts(추출 파이프라인)에서 분리(300줄 제약 — 로직 경계: actions.ts=추출, 이 파일=분석).
// AnalysisLens·AnalyzeItemErr 타입은 actions.ts가 SSOT(re-export 아님, 타입만 import).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getProviderConfig } from '@/lib/ai-chat/registry'
import type { ChatUsage } from '@/lib/ai-chat/provider'
import { logTokenUsage } from '@/lib/token-logger'
import { analyzeOneItem, synthesizeItems, type SynthItem } from '@/lib/ai-chat/analyze-core'
import type { AnalysisLens, AnalyzeItemErr } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const MAX_ITEM_TEXT_CHARS = 50_000 // 항목 1건 상한(DoS 방어 — 정상 목록항목은 이보다 훨씬 짧음)

const LENS_LABEL: Record<AnalysisLens, string> = {
  summary: '핵심 요약',
  risk: '리스크·우려사항',
  'action-plan': '실행계획(다음 액션)',
  evidence: '근거·출처 점검',
  compare: '비교·대안 검토',
}

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

/** Gemini 설정 조회(analyzeItem/synthesizeInsights 공용) — 미설정 시 null. */
async function getGeminiConfig() {
  const admin = createAdminClient() as AdminClient
  const meta = await readMeta(admin)
  return getProviderConfig(meta, 'gemini')
}

/** analyze-core 결과의 토큰 사용 로깅(analyzeItem/synthesizeInsights 공용, feature 고정). */
function logAnalyzeUsage(userId: string, model: string, usage: ChatUsage): void {
  logTokenUsage({
    userId,
    feature: 'ai-chat-analyze',
    model,
    provider: 'gemini',
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  })
}

export interface AnalyzeItemInput {
  itemText: string
  contextText: string
  lens: AnalysisLens
  customInstruction?: string
  /** 세션 선택 모델(NULL/미지정 시 org 기본). */
  model?: string
}
export interface AnalyzeItemOk {
  ok: true
  text: string
  usage: ChatUsage
  coverage?: { total: number; covered: number[]; missing: number[]; appended: number[] }
}

/** 항목 1건 심층분석 — 관점(lens)/자유 지시(command로 정규화) + 원문 컨텍스트(고립 아닌 맥락 기반). */
export async function analyzeItem(input: AnalyzeItemInput): Promise<AnalyzeItemOk | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const userId = auth.user.id

  const itemText = input.itemText.trim()
  if (!itemText) return { ok: false, error: '분석할 항목 텍스트가 비어 있습니다' }
  if (itemText.length > MAX_ITEM_TEXT_CHARS) {
    return { ok: false, error: '항목 텍스트가 너무 깁니다' }
  }

  const lensLabel = LENS_LABEL[input.lens] ?? LENS_LABEL.summary
  const custom = (input.customInstruction ?? '').trim()
  // command가 상위: 자유 지시가 있으면 그대로, 없으면 lens 라벨 기반 기본 명령으로 매핑.
  const command =
    custom ||
    `관점(${lensLabel})에서 핵심요지 / 배경·근거 / 리스크 / 다음 액션 섹션을 포함해 마크다운으로 심층 분석하라.`
  const contextExcerpt = input.contextText.trim() || undefined

  const cfg = await getGeminiConfig()
  if (!cfg) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

  try {
    const controller = new AbortController()
    const result = await analyzeOneItem({
      apiKey: cfg.apiKey,
      model: input.model?.trim() || cfg.model,
      itemText,
      contextExcerpt,
      command,
      signal: controller.signal,
    })
    if (!result.text.trim()) return { ok: false, error: '분석 결과가 비어 있습니다' }

    logAnalyzeUsage(userId, cfg.model, result.usage)
    return { ok: true, text: result.text, usage: result.usage }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '분석 중 오류가 발생했습니다' }
  }
}

/** 완료된 항목별 분석 결과를 모아 cross-item 무손실 종합 인사이트 생성(analyze-core synthesizeItems 재사용). */
export async function synthesizeInsights(
  entries: { itemText: string; resultText: string }[],
  model?: string,
): Promise<AnalyzeItemOk | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const userId = auth.user.id

  if (entries.length === 0) return { ok: false, error: '종합할 분석 결과가 없습니다' }

  const cfg = await getGeminiConfig()
  if (!cfg) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

  const items: SynthItem[] = entries.map((e, idx) => ({ idx, itemText: e.itemText, digest: e.resultText }))
  const command =
    '항목 간 공통 패턴·상충되는 지점·우선순위를 종합해 "종합 인사이트"를 마크다운으로 작성하라 ' +
    '(공통 테마 / 상충·트레이드오프 / 우선순위 제안 섹션 포함).'

  try {
    const controller = new AbortController()
    const result = await synthesizeItems({
      apiKey: cfg.apiKey,
      model: model?.trim() || cfg.model,
      items,
      command,
      signal: controller.signal,
    })
    if (!result.text.trim()) return { ok: false, error: '종합 결과가 비어 있습니다' }

    logAnalyzeUsage(userId, cfg.model, result.usage)
    return { ok: true, text: result.text, usage: result.usage, coverage: result.coverage }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '종합 중 오류가 발생했습니다' }
  }
}
