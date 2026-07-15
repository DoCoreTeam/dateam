'use server'

// 목록 심층분석 — 서버 액션 (requireAdminApi 게이트, Gemini 재사용).
// 파이프라인: 입력(붙여넣기/파일) → 텍스트 확보(포맷별 디스패치) → 1차 구조 파싱 + Gemini 보정(유실0 병합)
//            → (클라 검수) → 항목별 Gemini 심층분석(관점 선택 + 원문 컨텍스트).
// 핵심 계약(유실0): mergeExtractedItems가 보장 — parseListItems가 잡은 항목은 절대 사라지지 않는다.
// 항목 텍스트는 어떤 단계에서도 절단하지 않는다(원문 그대로).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getProviderConfig, getProvider } from '@/lib/ai-chat/registry'
import type { ChatUsage } from '@/lib/ai-chat/provider'
import { logTokenUsage } from '@/lib/token-logger'
import { htmlToPlain } from '@/lib/html-to-plain'
import { extractDocumentText, extractPdfText } from '@/lib/ai-chat/document-extract'
import { sniffMagicBytes } from '@/lib/ai-chat/attachments'
import {
  parseListItems,
  mergeExtractedItems,
  classifySourceMime,
  type MergedItem,
} from '@/lib/ai-chat/list-extract'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

const MAX_PASTE_CHARS = 300_000 // 붙여넣기 텍스트 상한 — 초과 시 절단 없이 에러(유실0 원칙)
const MAX_DOC_TEXT_CHARS = 100_000 // extractDocumentText/extractPdfText/HTML 공통 절단 상한(문서 SSOT와 동일)
const MAX_FILE_BYTES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  office: 10 * 1024 * 1024,
  text: 1 * 1024 * 1024,
  html: 2 * 1024 * 1024,
}
const MAX_ITEM_TEXT_CHARS = 50_000 // 항목 1건 상한(DoS 방어 — 정상 목록항목은 이보다 훨씬 짧음)
const MAX_CONTEXT_CHARS = 8_000 // analyzeItem에 배경으로 넘기는 원문 컨텍스트 상한(항목 본문 아님)

export type AnalysisLens = 'summary' | 'risk' | 'action-plan' | 'evidence' | 'compare'

const LENS_LABEL: Record<AnalysisLens, string> = {
  summary: '핵심 요약',
  risk: '리스크·우려사항',
  'action-plan': '실행계획(다음 액션)',
  evidence: '근거·출처 점검',
  compare: '비교·대안 검토',
}

const ZERO_USAGE: ChatUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

export interface AnalyzeExtractOk {
  ok: true
  items: MergedItem[]
  parsedCount: number
  restoredCount: number
  truncated: boolean
  sourceText: string
  usage: ChatUsage
}
export interface AnalyzeExtractErr {
  ok: false
  error: string
}
export type AnalyzeExtractResult = AnalyzeExtractOk | AnalyzeExtractErr

async function readMeta(admin: AdminClient): Promise<Record<string, unknown>> {
  const { data } = await admin.from('org_content').select('value').eq('key', 'META').single()
  return (data?.value as Record<string, unknown>) ?? {}
}

/** Gemini 1회 호출(비스트리밍 누적) — 프로바이더 SSOT(registry.ts) 재사용. 토큰 사용은 항상 로깅 + 호출측에 반환(§H 세션 토큰 표시). */
async function callGemini(
  userId: string,
  turnContent: string,
  attachments?: { kind: 'image'; mime: string; filename: string; dataBase64: string }[],
): Promise<{ text: string; usage: ChatUsage }> {
  const admin = createAdminClient() as AdminClient
  const meta = await readMeta(admin)
  const cfg = getProviderConfig(meta, 'gemini')
  if (!cfg) throw new Error('Gemini API 키가 설정되지 않았습니다')

  const provider = getProvider('gemini')
  const controller = new AbortController()
  let text = ''
  const result = await provider.streamChat({
    apiKey: cfg.apiKey,
    model: cfg.model,
    turns: [{ role: 'user', content: turnContent, attachments }],
    signal: controller.signal,
    onDelta: (d) => {
      text += d
    },
  })

  logTokenUsage({
    userId,
    feature: 'ai-chat-analyze',
    model: cfg.model,
    provider: 'gemini',
    promptTokens: result.usage.promptTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
  })

  return { text: result.text, usage: result.usage }
}

/** AI 응답에서 JSON 문자열 배열만 안전 파싱(코드펜스 방어). 실패 시 빈 배열(호출측이 1차 파싱으로 폴백). */
function parseJsonStringArray(raw: string): string[] {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  try {
    const parsed = JSON.parse(stripped)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

const EXTRACT_PROMPT_HEADER =
  '다음 자료에서 나열된 목록 항목을 하나도 빠짐없이 모두 추출하라.\n' +
  '- 번호·기호·문장형으로 나열된 항목을 전부 포함한다(형식 무관).\n' +
  '- 항목 텍스트는 원문 그대로 보존한다. 요약·축약·병합·생략을 절대 하지 않는다.\n' +
  '- 애매하면 누락시키지 말고 별도 항목으로 포함한다(누락보다 중복이 낫다).\n' +
  '- 목록이 아닌 일반 문장은 포함하지 않는다.\n' +
  '- 출력은 JSON 문자열 배열만. 다른 설명·마크다운 텍스트를 절대 추가하지 않는다.\n\n' +
  '자료:\n"""\n'

/** 텍스트 소스 → 1차 구조 파싱 + Gemini 보정 병합(유실0). Gemini 실패 시 1차 파싱 결과로만 폴백. */
async function extractFromText(userId: string, sourceText: string): Promise<AnalyzeExtractOk> {
  const parsed = parseListItems(sourceText)
  let aiTexts: string[] = []
  let usage: ChatUsage = ZERO_USAGE
  try {
    const raw = await callGemini(userId, `${EXTRACT_PROMPT_HEADER}${sourceText}\n"""`)
    aiTexts = parseJsonStringArray(raw.text)
    usage = raw.usage
  } catch {
    aiTexts = [] // 폴백 — 1차 파싱 결과만으로 진행(유실0은 여전히 보장)
  }
  const merge = mergeExtractedItems(parsed, aiTexts)
  return {
    ok: true,
    items: merge.items,
    parsedCount: merge.parsedCount,
    restoredCount: merge.restoredCount,
    truncated: false,
    sourceText,
    usage,
  }
}

/** 이미지 소스 → Gemini 비전으로 목록 항목 OCR·추출(1차 구조 파싱 불가 — AI 결과만 사용). */
async function extractFromImage(
  userId: string,
  mime: string,
  filename: string,
  dataBase64: string,
): Promise<AnalyzeExtractOk> {
  const prompt =
    '이 이미지 안에 나열된 목록 항목을 하나도 빠짐없이 모두 텍스트로 옮겨라(OCR).\n' +
    '- 번호·기호·문장형 나열 전부 포함. 항목 텍스트는 원문 그대로(요약·생략 금지).\n' +
    '- 출력은 JSON 문자열 배열만.'
  const raw = await callGemini(userId, prompt, [{ kind: 'image', mime, filename, dataBase64 }])
  const aiTexts = parseJsonStringArray(raw.text)
  const merge = mergeExtractedItems([], aiTexts)
  return {
    ok: true,
    items: merge.items,
    parsedCount: 0,
    restoredCount: 0,
    truncated: false,
    sourceText: '',
    usage: raw.usage,
  }
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DOC_TEXT_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_DOC_TEXT_CHARS), truncated: true }
}

/**
 * 목록 항목 추출 — 붙여넣기 텍스트 또는 업로드 파일(전 포맷) 지원.
 * formData: 'text'(string, 붙여넣기) 또는 'file'(File) 중 최소 1개.
 * 지원 포맷: txt/md/csv/json(text) · docx/xlsx/pptx(office) · pdf · html/htm · png/jpg/webp(image, 비전).
 */
export async function extractItems(formData: FormData): Promise<AnalyzeExtractResult> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const userId = auth.user.id

  const pastedText = formData.get('text')
  const file = formData.get('file')

  if (!(file instanceof File) && typeof pastedText !== 'string') {
    return { ok: false, error: '텍스트를 붙여넣거나 파일을 첨부하세요' }
  }

  if (file instanceof File) {
    const method = classifySourceMime(file.type, file.name)
    if (!method) {
      return { ok: false, error: '지원하지 않는 파일 형식입니다' }
    }
    const cap = MAX_FILE_BYTES[method]
    if (file.size > cap) {
      return { ok: false, error: `파일 크기가 상한(${Math.floor(cap / (1024 * 1024))}MB)을 초과합니다` }
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength <= 0) return { ok: false, error: '빈 파일은 처리할 수 없습니다' }
    if (bytes.byteLength > cap) {
      return { ok: false, error: `파일 크기가 상한(${Math.floor(cap / (1024 * 1024))}MB)을 초과합니다` }
    }
    // 매직바이트 스니핑(mime 위장 방어) — mime이 정확히 일치하는 경우만 적용(확장자 폴백 케이스는 생략)
    if (file.type && !sniffMagicBytes(bytes, file.type) && method !== 'text' && method !== 'html') {
      return { ok: false, error: '파일 내용이 형식과 일치하지 않습니다' }
    }

    try {
      if (method === 'image') {
        const dataBase64 = Buffer.from(bytes).toString('base64')
        return await extractFromImage(userId, file.type || 'image/png', file.name, dataBase64)
      }

      let text: string
      let truncated = false
      if (method === 'pdf') {
        text = await extractPdfText(bytes)
        truncated = text.endsWith('[이하 절단]')
      } else if (method === 'office') {
        text = await extractDocumentText(bytes, file.type)
        truncated = text.endsWith('[이하 절단]')
      } else if (method === 'html') {
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        const plain = htmlToPlain(decoded)
        const capped = capText(plain)
        text = capped.text
        truncated = capped.truncated
      } else {
        // text: txt/md/csv/json — mime이 DOCUMENT_TEXT_MIMES 목록과 다를 수 있어(csv 등) 안전하게 보정
        const knownTextMime = ['text/plain', 'text/markdown', 'text/csv', 'application/json']
        const mimeForExtract = knownTextMime.includes(file.type) ? file.type : 'text/plain'
        text = await extractDocumentText(bytes, mimeForExtract)
        truncated = text.endsWith('[이하 절단]')
      }

      if (!text.trim()) return { ok: false, error: '파일에서 텍스트를 추출하지 못했습니다' }
      const result = await extractFromText(userId, text.replace(/\[이하 절단\]$/, ''))
      return { ...result, truncated }
    } catch {
      return { ok: false, error: '파일에서 텍스트를 추출하지 못했습니다' }
    }
  }

  const text = (pastedText as string).trim()
  if (!text) return { ok: false, error: '텍스트를 입력하세요' }
  if (text.length > MAX_PASTE_CHARS) {
    return {
      ok: false,
      error: `입력이 너무 깁니다(최대 ${MAX_PASTE_CHARS.toLocaleString()}자). 나눠서 시도해주세요.`,
    }
  }
  return extractFromText(userId, text)
}

export interface AnalyzeItemInput {
  itemText: string
  contextText: string
  lens: AnalysisLens
  customInstruction?: string
}
export interface AnalyzeItemOk {
  ok: true
  text: string
  usage: ChatUsage
}
export interface AnalyzeItemErr {
  ok: false
  error: string
}

/** 항목 1건 심층분석 — 관점(lens) + 자유 지시 + 원문 컨텍스트(고립 아닌 맥락 기반). */
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
  const context = input.contextText.trim().slice(0, MAX_CONTEXT_CHARS)
  const custom = (input.customInstruction ?? '').trim()

  const promptParts = [
    `아래 "분석 대상 항목"을 관점(${lensLabel})에서 심층 분석하라.`,
    '이 항목은 더 큰 목록·자료의 일부이므로, 아래 "원문 컨텍스트"를 참고해 고립되지 않은 분석을 하라.',
    '출력은 마크다운으로: 핵심요지 / 배경·근거 / 리스크 / 다음 액션 섹션을 포함하라(관점에 맞게 비중 조절 가능).',
  ]
  if (custom) promptParts.push(`추가 지시: ${custom}`)
  if (context) promptParts.push(`\n원문 컨텍스트(배경 참고용):\n"""\n${context}\n"""`)
  promptParts.push(`\n분석 대상 항목:\n"""\n${itemText}\n"""`)

  try {
    const raw = await callGemini(userId, promptParts.join('\n\n'))
    if (!raw.text.trim()) return { ok: false, error: '분석 결과가 비어 있습니다' }
    return { ok: true, text: raw.text, usage: raw.usage }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '분석 중 오류가 발생했습니다' }
  }
}

const MAX_SYNTH_ITEMS_CHARS = 30_000 // 종합 인사이트 입력 상한(비용 방어 — 분석 자체를 자르는 게 아니라 종합요약 입력 캡)

/** 완료된 항목별 분석 결과를 모아 cross-item 종합 인사이트 생성. */
export async function synthesizeInsights(
  entries: { itemText: string; resultText: string }[],
): Promise<AnalyzeItemOk | AnalyzeItemErr> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const userId = auth.user.id

  if (entries.length === 0) return { ok: false, error: '종합할 분석 결과가 없습니다' }

  const body = entries
    .map((e, idx) => `### 항목 ${idx + 1}: ${e.itemText}\n${e.resultText}`)
    .join('\n\n')
    .slice(0, MAX_SYNTH_ITEMS_CHARS)

  const prompt =
    '아래는 여러 항목을 각각 심층분석한 결과다. 항목 간 공통 패턴·상충되는 지점·우선순위를 종합해 ' +
    '"종합 인사이트"를 마크다운으로 작성하라(공통 테마 / 상충·트레이드오프 / 우선순위 제안 섹션 포함).\n\n' +
    body

  try {
    const raw = await callGemini(userId, prompt)
    if (!raw.text.trim()) return { ok: false, error: '종합 결과가 비어 있습니다' }
    return { ok: true, text: raw.text, usage: raw.usage }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '종합 중 오류가 발생했습니다' }
  }
}

// §G 영속 저장(세션/항목 CRUD)과 §F AI채팅 연계는 session-actions.ts로 분리(파일당 300줄 내 유지).
// export: listAnalysisSessions·saveAnalysisSession·updateAnalysisItem·getAnalysisSession·continueInChat
