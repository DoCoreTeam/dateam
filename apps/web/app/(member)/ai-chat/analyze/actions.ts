'use server'

// 목록 심층분석 — 추출 파이프라인 서버 액션(requireAdminApi 게이트, Gemini 재사용).
// 파이프라인: 입력(붙여넣기/파일) → 텍스트 확보(포맷별 디스패치) → 1차 구조 파싱 + Gemini 보정(유실0 병합)
//            → (클라 검수, ItemReviewList로 넘김).
// 핵심 계약(유실0): mergeExtractedItems가 보장 — parseListItems가 잡은 항목은 절대 사라지지 않는다.
// 항목 텍스트는 어떤 단계에서도 절단하지 않는다(원문 그대로).
// 항목별 심층분석(analyzeItem)·종합(synthesizeInsights)은 analyze-item-actions.ts로 분리(300줄 제약 —
// 로직 경계: 이 파일=추출, 그 파일=분석. AnalysisLens·AnalyzeItemErr 타입은 이 파일이 SSOT).

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
export type AnalysisLens = 'summary' | 'risk' | 'action-plan' | 'evidence' | 'compare'

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


export interface ExtractTextOk {
  ok: true
  sourceText: string
  truncated: boolean
}
export type ExtractTextResult = ExtractTextOk | AnalyzeExtractErr

/**
 * 파일 → **원문 텍스트만** 추출(그룹핑 파이프라인 전용).
 *
 * 왜 별도 액션인가: 그룹핑 재정의 이후 화면은 `sourceText`만 필요한데, extractItems를 재사용하면
 * 파일마다 구 평탄화 파서(parseListItems) + 전체 원문 Gemini 호출(EXTRACT_PROMPT_HEADER)이
 * 돌고 그 결과가 100% 폐기된다 — 사용자 모르게 매 업로드마다 AI 비용이 나간다(🟥 DC-REV HIGH-1).
 * 이미지(OCR)는 AI가 없으면 텍스트 자체를 얻을 수 없으므로 예외로 비전 호출을 유지한다.
 */
export async function extractSourceText(formData: FormData): Promise<ExtractTextResult> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: '파일을 첨부하세요' }

  const method = classifySourceMime(file.type, file.name)
  if (!method) return { ok: false, error: '지원하지 않는 파일 형식입니다' }
  const cap = MAX_FILE_BYTES[method]
  if (file.size > cap) {
    return { ok: false, error: `파일 크기가 상한(${Math.floor(cap / (1024 * 1024))}MB)을 초과합니다` }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength <= 0) return { ok: false, error: '빈 파일은 처리할 수 없습니다' }
  if (bytes.byteLength > cap) {
    return { ok: false, error: `파일 크기가 상한(${Math.floor(cap / (1024 * 1024))}MB)을 초과합니다` }
  }
  if (file.type && !sniffMagicBytes(bytes, file.type) && method !== 'text' && method !== 'html') {
    return { ok: false, error: '파일 내용이 형식과 일치하지 않습니다' }
  }

  try {
    if (method === 'image') {
      // 이미지는 OCR 없이는 원문을 얻을 수 없다 — 비전 1회 호출은 불가피(폐기되는 호출 아님)
      const dataBase64 = Buffer.from(bytes).toString('base64')
      const r = await extractFromImage(auth.user.id, file.type || 'image/png', file.name, dataBase64)
      return { ok: true, sourceText: r.items.map((it) => it.text).join('\n'), truncated: false }
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
      const capped = capText(htmlToPlain(new TextDecoder('utf-8', { fatal: false }).decode(bytes)))
      text = capped.text
      truncated = capped.truncated
    } else {
      const knownTextMime = ['text/plain', 'text/markdown', 'text/csv', 'application/json']
      const mimeForExtract = knownTextMime.includes(file.type) ? file.type : 'text/plain'
      text = await extractDocumentText(bytes, mimeForExtract)
      truncated = text.endsWith('[이하 절단]')
    }

    const clean = text.replace(/\[이하 절단\]$/, '')
    if (!clean.trim()) return { ok: false, error: '파일에서 텍스트를 추출하지 못했습니다' }
    return { ok: true, sourceText: clean, truncated }
  } catch {
    return { ok: false, error: '파일에서 텍스트를 추출하지 못했습니다' }
  }
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

export interface AnalyzeItemErr {
  ok: false
  error: string
}

// 항목별 심층분석(analyzeItem)·cross-item 종합(synthesizeInsights)은 analyze-item-actions.ts로 분리
// (파일당 300줄 제약). §G 영속 저장(세션/항목 CRUD)과 §F AI채팅 연계는 session-list-actions.ts·
// session-item-actions.ts·session-persist-actions.ts로 분리.
