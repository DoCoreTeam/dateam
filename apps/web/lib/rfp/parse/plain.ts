/**
 * 글자 파일을 IR 로 (txt·csv·md·html)
 *
 * ## 왜 뒤늦게 생겼나
 *
 * 종류 판정은 `text` 라고 하는데 그 종류를 읽는 파서가 **없었다.**
 * `ROUTES` 는 text 를 officeparser 로 보냈지만 officeparser 는 평문을 모른다 —
 * 그래서 `unsupported_format:format=unknown` 으로 죽었다. 판정과 처리가 어긋난 것이다.
 * (실측 2026-09-09: 시험용 공고문 txt 가 파싱 3회 재시도 후 dead)
 *
 * ## 인코딩
 *
 * 공공기관 파일은 아직 EUC-KR 이 섞여 있다. UTF-8 로 읽어 깨지면 EUC-KR 로 한 번 더 본다 —
 * 깨진 채로 넘기면 뒷단계가 전부 「글자가 이상한 문서」를 분석한다.
 */

import { makeBlock, makeDocument, qualityScore } from '../ir/build.ts'
import type { IrBlock, IrDocument } from '../ir/types.ts'

export type PlainRejectReason = 'empty' | 'undecodable'

export type PlainParseResult =
  | { ok: true; doc: IrDocument }
  | { ok: false; reason: PlainRejectReason; detail: string }

export const PARSER_NAME = 'plain'
export const PARSER_VERSION = '1'

/** 이 비율보다 깨진 글자가 많으면 다른 인코딩으로 본다 */
export const REPLACEMENT_RATIO = 0.01

/**
 * 바이트를 글자로.
 *
 * UTF-8 이 기본이고, 대체 문자(U+FFFD)가 눈에 띄게 많으면 EUC-KR 로 다시 읽는다.
 * 「조금 깨진 것」과 「인코딩이 다른 것」은 대체 문자 비율로 갈린다.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (replacementRatio(utf8) <= REPLACEMENT_RATIO) return utf8

  try {
    const euc = new TextDecoder('euc-kr').decode(bytes)
    // 둘 다 깨졌으면 덜 깨진 쪽을 준다 — 아무것도 안 주는 것보다 낫다
    return replacementRatio(euc) < replacementRatio(utf8) ? euc : utf8
  } catch {
    return utf8
  }
}

function replacementRatio(s: string): number {
  if (s.length === 0) return 0
  let n = 0
  for (const ch of s) if (ch === '�') n += 1
  return n / s.length
}

/** HTML 이면 태그를 벗긴다 — 태그를 그대로 두면 블록마다 마크업이 근거로 남는다 */
export function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
}

/** 빈 줄로 문단을 나눈다. 문단이 없으면 줄 단위로 — 한 덩이로 두면 근거를 못 가리킨다 */
export function toParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const byBlank = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (byBlank.length > 1) return byBlank
  return normalized.split('\n').map((p) => p.trim()).filter(Boolean)
}

export interface PlainParseOptions {
  fileId: string
  fileName?: string
  fileRole?: string
}

export function parsePlain(bytes: Uint8Array, opts: PlainParseOptions): PlainParseResult {
  const raw = decodeText(bytes)
  if (raw === null) return { ok: false, reason: 'undecodable', detail: '' }

  const isHtml = /\.(html?|xhtml)$/i.test(opts.fileName ?? '') || /<html[\s>]|<body[\s>]/i.test(raw.slice(0, 2000))
  const text = isHtml ? stripHtml(raw) : raw

  const paragraphs = toParagraphs(text)
  if (paragraphs.length === 0) return { ok: false, reason: 'empty', detail: '읽을 글자가 없다' }

  const blocks: IrBlock[] = paragraphs.map((p, i) => makeBlock(opts.fileId, i, {
    type: 'paragraph',
    text: p,
    // 평문에는 쪽도 노드 경로도 없다. 몇 번째 문단인지가 유일한 자리다
    sourceRef: { kind: 'text', paraIdx: i },
  }))

  const doc = makeDocument({
    meta: {
      fileRole: opts.fileRole ?? 'etc',
      format: isHtml ? 'html' : 'text',
      pageCount: 0,
      parser: PARSER_NAME,
      parserVersion: PARSER_VERSION,
      // 평문은 글자를 100% 건진다. 표·좌표가 없는 것은 형식의 성질이지 파싱 실패가 아니다
      qualityScore: qualityScore({
        textPageRatio: 1,
        tableCount: 0,
        avgOcrConfidence: null,
        sectionDepth: 1,
        warningCount: 0,
      }),
      warnings: [],
    },
    pages: [],
    sections: [],
    blocks,
    tables: [],
    figures: [],
  })

  return { ok: true, doc }
}
