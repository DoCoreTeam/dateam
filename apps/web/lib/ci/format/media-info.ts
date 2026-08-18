// lib/ci/format/media-info.ts — 영상 실체 행 → 표시 형태 변환 SSOT
//
// DB 접근과 분리해 둔 이유는 creative-info.ts와 같다: 이 변환이 표시 규칙 그 자체다.
// (조회는 `lib/ci/queries/media.ts`, 표시는 `components/ci/MediaSummary.tsx`)

import { formatKstDateTimeShort } from '../../datetime/kst.ts'
import type { CiMediaInfo } from '../contracts.ts'

export interface MediaRow {
  content_id: string
  transcript: string | null
  on_screen_text: string[] | null
  beats: unknown
  hook_device: string | null
  hook_message: string | null
  ending: string | null
  cut_count: number | null
  pacing: string | null
  shot_types: string[] | null
  aspect: string | null
  has_subtitle: boolean | null
  subtitle_style: string | null
  audio_style: string | null
  setting: string | null
  people_count: number | null
  topic_guess: string | null
  topic_evidence: string | null
  why_it_works: string | null
  replicable_formula: string | null
  access_method: string | null
  evidence: Record<string, unknown> | null
  analyzed_at: string | null
}

/**
 * 무엇으로 봤는지를 사람 말로.
 *
 * 이 한 줄이 중요한 이유: 커버 이미지만 본 결과와 영상을 통째로 본 결과를
 * 같은 모양으로 보여주면 사용자가 신뢰도를 구분할 수 없다.
 *
 * **시도한 방법이 아니라 실제 성과로 말한다.** 영상 주소를 넘겼지만 실패했는데
 * "영상 전체를 읽음"이라고 하면 화면이 거짓말을 한다(실측으로 잡음).
 */
export function accessLabel(access: string | null, gotSomething: boolean): string {
  if (!gotSomething) return '영상을 읽지 못함'
  switch (access) {
    case 'remote_video': return '영상 전체를 읽음'
    case 'still_image': return '커버 이미지만 읽음'
    default: return '영상을 읽지 못함'
  }
}

/**
 * 실패 사유를 **사용자가 읽을 수 있는 말**로.
 *
 * 왜 필요한가: 외부 API 원문이 그대로 화면에 떴다 —
 * `AI 응답 실패 (429) { "error": { "code": 429, "message": "You exceeded your current quota..." } }`
 * 사용자는 이걸 읽고 무엇을 해야 할지 알 수 없고, 제품이 고장난 것처럼 보인다.
 * 원문은 evidence에 남아 있으므로 진단은 그대로 가능하다.
 */
export function humanizeMediaError(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t) return null

  if (/\(429\)|429|quota|rate limit/i.test(t)) {
    return 'AI 사용량 한도에 걸려 잠시 멈췄습니다. 한도가 풀리면 자동으로 다시 시도합니다'
  }
  if (/시간 안에 오지 않았습니다|timeout/i.test(t)) {
    return '영상이 길어 분석이 시간 안에 끝나지 않았습니다. 다시 시도합니다'
  }
  if (/\(5\d\d\)/.test(t)) {
    return 'AI 서비스가 일시적으로 응답하지 않았습니다. 다시 시도합니다'
  }
  if (/\(40[34]\)|not found|forbidden/i.test(t)) {
    return '이 영상에 접근할 수 없습니다. 비공개이거나 삭제되었을 수 있습니다'
  }
  if (/키가 (설정되지 않았습니다|없어)/.test(t)) {
    return 'AI 키가 설정되지 않아 영상을 읽지 못했습니다'
  }
  // 우리가 직접 쓴 한국어 문구는 그대로 보여준다 — 이미 사용자 말이다.
  if (/[가-힣]/.test(t) && !/\{|"error"|http/i.test(t)) return t

  return '영상을 읽는 중 문제가 생겼습니다. 다시 시도합니다'
}

/**
 * 연출 스펙을 한 줄로 — "세로 · 컷 12회 · 자막 있음 · 대화 · 2명".
 * 항목마다 줄을 만들면 대부분 비어 있어 화면이 구멍투성이가 된다.
 */
export function productionText(row: MediaRow): string | null {
  const bits: string[] = []
  if (row.aspect) bits.push(row.aspect)
  if (row.cut_count != null) bits.push(`컷 ${row.cut_count}회`)
  if (row.pacing) bits.push(`전개 ${row.pacing}`)
  if (row.has_subtitle === true) bits.push('자막 있음')
  else if (row.has_subtitle === false) bits.push('자막 없음')
  if (row.audio_style) bits.push(row.audio_style)
  if (row.people_count != null) bits.push(`${row.people_count}명`)
  if (row.shot_types && row.shot_types.length > 0) bits.push(row.shot_types.slice(0, 3).join('·'))
  return bits.length > 0 ? bits.join(' · ') : null
}

function parseBeats(v: unknown): { t: string; what: string }[] {
  if (!Array.isArray(v)) return []
  const out: { t: string; what: string }[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.t !== 'string' || typeof row.what !== 'string') continue
    out.push({ t: row.t, what: row.what })
  }
  return out
}

export function toMediaInfo(row: MediaRow): CiMediaInfo {
  const evidence = row.evidence ?? {}
  const rawNote = evidence.note
  // 원문은 evidence에 그대로 남는다(진단용). 화면에는 사람 말만 내보낸다.
  const note = humanizeMediaError(typeof rawNote === 'string' ? rawNote : null)
  const gotSomething = Boolean(
    row.transcript || row.topic_guess || (row.on_screen_text?.length ?? 0) > 0,
  )
  // 못 읽었으면 '방법'을 말하지 않는다 — 시도한 방법을 성과처럼 보여주면 화면이 거짓말한다.
  const access = gotSomething && (row.access_method === 'remote_video' || row.access_method === 'still_image')
    ? row.access_method
    : 'none'

  return {
    access,
    accessLabel: accessLabel(row.access_method, gotSomething),
    transcript: row.transcript,
    onScreenText: row.on_screen_text ?? [],
    beats: parseBeats(row.beats),
    hookDevice: row.hook_device,
    hookMessage: row.hook_message,
    ending: row.ending,
    productionText: productionText(row),
    setting: row.setting,
    topicGuess: row.topic_guess,
    topicEvidence: row.topic_evidence,
    whyItWorks: row.why_it_works,
    replicableFormula: row.replicable_formula,
    note,
    analyzedAtText: row.analyzed_at ? formatKstDateTimeShort(row.analyzed_at) : null,
  }
}

/**
 * 보여줄 것이 하나라도 있는가.
 * 전부 비었는데 카드만 그리면 사용자는 "고장났나"라고 읽는다 —
 * 그때는 카드 대신 **왜 비었는지**를 말해야 한다.
 */
export function hasAnythingToShow(info: CiMediaInfo): boolean {
  return Boolean(
    info.transcript || info.onScreenText.length > 0 || info.beats.length > 0 ||
    info.topicGuess || info.whyItWorks || info.productionText || info.setting,
  )
}
