// lib/ci/ai/brief.ts — 기획안 생성 (설계서 §7 P02)
// AI 결과는 미리보기·편집 후 저장한다(생성형 패턴). 자동 확정 저장 금지.

import type { CiPlatform } from '../types.ts'

export interface BriefDraft {
  titleOptions: string[]
  hook: string
  script: string
  caption: string
  tags: string[]
  thumbnailIdeas: string[]
}

export const EMPTY_BRIEF: BriefDraft = {
  titleOptions: [], hook: '', script: '', caption: '', tags: [], thumbnailIdeas: [],
}

export interface BriefPromptInput {
  ideaTitle: string
  note: string | null
  topicName: string | null
  platforms: CiPlatform[]
  brandVoice: string
  locale: string
  /** 근거로 삼을 떡상 콘텐츠 제목과 배수 문장 */
  evidence: { title: string; outlierText: string | null }[]
  /** 적용할 성공 공식 문장 */
  patterns: string[]
  /** 부분 재생성이면 이 필드만 다시 만든다 */
  fields?: (keyof BriefDraft)[]
}

const FIELD_LABEL: Record<keyof BriefDraft, string> = {
  titleOptions: '제목 시안 5개',
  hook: '첫 3초 훅 문장',
  script: '대본 개요 (문단 구분)',
  caption: '게시용 캡션',
  tags: '해시태그 8개 이내 (# 없이)',
  thumbnailIdeas: '썸네일 시안 설명 3개',
}

export function buildBriefPrompt(input: BriefPromptInput): string {
  const fields = input.fields?.length
    ? input.fields
    : (Object.keys(FIELD_LABEL) as (keyof BriefDraft)[])

  const evidence = input.evidence.length
    ? input.evidence.map((e) => `- ${e.title}${e.outlierText ? ` (${e.outlierText})` : ''}`).join('\n')
    : '- (참고할 성과 데이터가 아직 없습니다)'

  const patterns = input.patterns.length
    ? input.patterns.map((p) => `- ${p}`).join('\n')
    : '- (확인된 성공 공식이 아직 없습니다)'

  const shape: Record<string, string> = {}
  for (const f of fields) {
    shape[f] = f === 'titleOptions' || f === 'tags' || f === 'thumbnailIdeas' ? '["문자열", ...]' : '"문자열"'
  }

  return [
    '당신은 한국어 콘텐츠 기획자입니다. 아래 정보를 바탕으로 기획안을 작성하세요.',
    '',
    `아이디어: ${input.ideaTitle}`,
    input.note ? `메모: ${input.note}` : '',
    input.topicName ? `주제: ${input.topicName}` : '',
    `대상 플랫폼: ${input.platforms.length ? input.platforms.join(', ') : '미지정'}`,
    input.brandVoice ? `말투 지침: ${input.brandVoice}` : '말투 지침: 중립적이고 담백하게',
    '',
    '참고할 성과가 좋았던 콘텐츠:',
    evidence,
    '',
    '이 주제에서 확인된 성공 공식:',
    patterns,
    '',
    '작성할 항목:',
    fields.map((f) => `- ${f}: ${FIELD_LABEL[f]}`).join('\n'),
    '',
    '아래 JSON만 출력하세요. 설명 문장이나 코드펜스를 넣지 마세요.',
    `{${fields.map((f) => `"${f}": ${shape[f]}`).join(', ')}}`,
    '',
    '근거가 없는 수치나 사실을 지어내지 마세요. 확인되지 않은 통계를 문장에 넣지 마세요.',
  ].filter(Boolean).join('\n')
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim()).slice(0, max)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * AI 응답 파싱. 형식이 깨지면 null을 돌려준다 —
 * 반쯤 깨진 결과를 저장해 사용자가 치우게 만들지 않는다.
 */
export function parseBriefDraft(raw: string, base: BriefDraft = EMPTY_BRIEF): BriefDraft | null {
  const m = /\{[\s\S]*\}/.exec(raw)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const draft: BriefDraft = {
      titleOptions: 'titleOptions' in j ? asStringArray(j.titleOptions, 5) : base.titleOptions,
      hook: 'hook' in j ? asString(j.hook) : base.hook,
      script: 'script' in j ? asString(j.script) : base.script,
      caption: 'caption' in j ? asString(j.caption) : base.caption,
      tags: 'tags' in j ? asStringArray(j.tags, 8).map((t) => t.replace(/^#/, '')) : base.tags,
      thumbnailIdeas: 'thumbnailIdeas' in j ? asStringArray(j.thumbnailIdeas, 3) : base.thumbnailIdeas,
    }
    const empty = draft.titleOptions.length === 0 && !draft.hook && !draft.script
      && !draft.caption && draft.tags.length === 0 && draft.thumbnailIdeas.length === 0
    return empty ? null : draft
  } catch {
    return null
  }
}
