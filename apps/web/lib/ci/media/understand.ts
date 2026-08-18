// lib/ci/media/understand.ts — 영상 실체 이해 (순수 함수)
//
// 이 파일은 DB도 네트워크도 모른다. 프롬프트를 만들고 응답을 읽을 뿐이다.
// 그래야 "무엇을 뽑기로 했는가"를 테스트로 못 박을 수 있다.
//
// ── 무엇을 뽑는가 ────────────────────────────────────────────────
// 지금까지 크리에이티브 분석(ai/creative.ts)이 본 것은 **썸네일 한 장과 제목**이었다.
// 그것은 영상의 표지일 뿐이고, 숏폼에서 표지는 내용의 아주 작은 일부다.
// 여기서는 영상 안에서 **실제로 관측되는 것**을 넷으로 나눠 뽑는다.
//
//   말과 글  대사 전문 · 화면에 박힌 자막   → 검색과 인용의 대상이 된다
//   구조     구간별 전개 · 훅 · 엔딩         → 편집점 화면이 쓸 타임라인이 된다
//   연출     컷 수 · 샷 · 자막 · 오디오      → 우리가 따라 만들 제작 스펙이 된다
//   판단     주제 근거 · 통한 이유 · 공식    → 기획으로 바로 넘어간다
//
// 원칙은 creative.ts와 같다: **관측 가능한 것만.** 안 보이면 null이다.
// 다만 "안 보인다"의 뜻이 달라졌다 — 예전엔 썸네일에 안 적혀 있으면 없는 것이었고,
// 지금은 영상 어디에도 안 나오면 없는 것이다.

/** 구간별 전개 한 칸. t는 "0-3"처럼 초 단위 구간 */
export interface MediaBeat {
  t: string
  what: string
}

export interface MediaUnderstanding {
  // ── 말과 글 ──
  transcript: string | null
  onScreenText: string[]
  // ── 구조 ──
  beats: MediaBeat[]
  hookDevice: string | null
  hookMessage: string | null
  ending: string | null
  // ── 연출 ──
  cutCount: number | null
  pacing: string | null
  shotTypes: string[]
  aspect: string | null
  hasSubtitle: boolean | null
  subtitleStyle: string | null
  audioStyle: string | null
  // ── 상황 ──
  setting: string | null
  peopleCount: number | null
  // ── 판단 ──
  topicGuess: string | null
  topicEvidence: string | null
  whyItWorks: string | null
  replicableFormula: string | null
  loopable: boolean | null
  ctaPresent: boolean | null
}

export const EMPTY_UNDERSTANDING: MediaUnderstanding = {
  transcript: null, onScreenText: [],
  beats: [], hookDevice: null, hookMessage: null, ending: null,
  cutCount: null, pacing: null, shotTypes: [], aspect: null,
  hasSubtitle: null, subtitleStyle: null, audioStyle: null,
  setting: null, peopleCount: null,
  topicGuess: null, topicEvidence: null, whyItWorks: null,
  replicableFormula: null, loopable: null, ctaPresent: null,
}

/** 전개 속도 — 화면과 프롬프트가 같은 목록을 쓴다. */
export const PACING_VALUES = ['빠름', '보통', '느림'] as const

/** 샷 종류 — 자유 서술을 허용하면 같은 것이 다섯 가지 말로 쌓인다. */
export const SHOT_TYPES = [
  '클로즈업', '미디엄', '풀샷', '셀카', '핸드헬드', '고정',
  '화면녹화', '항공·드론', '타임랩스', '인터뷰',
] as const

export const AUDIO_STYLES = [
  '내레이션', '현장음', 'BGM중심', '무음', '대화', '노래·연주',
] as const

export const ASPECT_VALUES = ['세로', '가로', '정사각'] as const

/** 훅 장치 — 첫 3초가 시선을 잡는 방식. creative.ts의 HOOK_TYPES(메시지 유형)와 다른 축이다. */
export const HOOK_DEVICES = [
  '결과 먼저', '질문 던지기', '충격 장면', '자막 선언', '인물 등장',
  '비교 제시', '동작 시작', '소리·효과음', '텍스트 나열', '상황 설정',
] as const

/* ───────────────────────── 프롬프트 ───────────────────────── */

export interface UnderstandPromptInput {
  /** 영상을 통째로 읽히는가, 정지 이미지만 읽히는가 */
  hasVideo: boolean
  hasImage: boolean
  title: string | null
  caption: string | null
  durationSec: number | null
}

/**
 * 프롬프트를 만든다.
 *
 * 영상을 읽는 경우와 이미지만 읽는 경우의 지시가 다르다 —
 * 이미지 한 장을 주고 "대사를 받아써라"라고 하면 모델은 지어낸다.
 * **줄 수 있는 것에 맞춰 물어야 거짓말이 줄어든다.**
 */
export function buildUnderstandPrompt(input: UnderstandPromptInput): string {
  const lines: string[] = []

  if (input.hasVideo) {
    lines.push(
      '함께 주는 것은 이 게시물의 **영상 원본**입니다. 영상을 처음부터 끝까지 실제로 보고 답하세요.',
      '들리는 말과 화면에 보이는 글자를 **그대로** 옮기세요. 요약하거나 다듬지 마세요.',
    )
  } else if (input.hasImage) {
    lines.push(
      '함께 주는 것은 이 게시물의 **커버 이미지 한 장**입니다. 영상은 제공되지 않았습니다.',
      '이미지에서 관측되는 것만 답하세요. 대사(transcript)·구간 전개(beats)·컷 수처럼',
      '영상을 봐야 알 수 있는 항목은 **반드시 null 또는 빈 배열**로 두세요. 추측해서 채우지 마세요.',
    )
  } else {
    lines.push(
      '영상도 이미지도 제공되지 않았습니다. 제목과 설명만으로 알 수 있는 것만 답하고',
      '나머지는 전부 null 또는 빈 배열로 두세요.',
    )
  }

  lines.push(
    '',
    `제목: ${input.title ?? '(없음)'}`,
    `설명: ${(input.caption ?? '(없음)').slice(0, 800)}`,
    input.durationSec != null ? `길이: ${input.durationSec}초` : '길이: (모름)',
    '',
    '아래 JSON만 출력하세요. 코드펜스나 설명 문장을 붙이지 마세요.',
    '{',
    '  "transcript": "들리는 말 전체를 시간순으로 이어붙인 글. 말이 없으면 null",',
    '  "onScreenText": ["화면에 박힌 자막·텍스트를 나온 순서대로 그대로"],',
    '  "beats": [{"t": "0-3", "what": "..."}, {"t": "3-12", "what": "..."}, {"t": "12-25", "what": "..."}],',
    `  "hookDevice": "${HOOK_DEVICES.join('|')} 중 첫 3초에 해당하는 하나",`,
    '  "hookMessage": "첫 3초가 던지는 핵심 메시지 (영상에서 그대로 인용)",',
    '  "ending": "어떻게 끝나는지 한 문장",',
    '  "cutCount": 컷 전환 대략 횟수(정수) 또는 null,',
    `  "pacing": "${PACING_VALUES.join('|')} 중 하나",`,
    `  "shotTypes": ["${SHOT_TYPES.join('", "')}" 중 관측된 것들],`,
    `  "aspect": "${ASPECT_VALUES.join('|')} 중 하나",`,
    '  "hasSubtitle": true 또는 false,',
    '  "subtitleStyle": "자막의 위치·서체·색을 한 문장. 자막이 없으면 null",',
    `  "audioStyle": "${AUDIO_STYLES.join('|')} 중 하나",`,
    '  "setting": "장소나 상황 한 문장",',
    '  "peopleCount": 화면에 나오는 사람 수(정수) 또는 null,',
    '  "topicGuess": "이 콘텐츠의 주제를 한 단어로",',
    '  "topicEvidence": "그렇게 본 근거를 영상 속 말이나 장면에서 인용",',
    '  "whyItWorks": "왜 시청자를 붙잡았는지 한 문장",',
    '  "replicableFormula": "우리가 따라 만든다면 지켜야 할 공식 한 줄",',
    '  "loopable": true 또는 false,',
    '  "ctaPresent": true 또는 false',
    '}',
    '',
    '보이지 않고 들리지 않는 것은 지어내지 마세요. 모르면 null이나 빈 배열로 두세요.',
    '주제(topicGuess)는 반드시 topicEvidence에 인용할 근거가 있을 때만 적으세요.',
    // beats는 편집점 화면이 쓸 타임라인이다. 한 칸만 오면 타임라인이 아니라 요약문이 된다.
    // (실측: 지시 없이 예시만 한 칸 주었더니 21건 중 19건이 1칸으로 왔다)
    'beats는 영상 **전체를 처음부터 끝까지** 구간으로 나눠 주세요. 장면이나 화제가 바뀌는 지점마다 한 칸입니다.',
    '한 칸만 만들지 마세요. 짧은 영상도 보통 3칸 이상이고, 마지막 칸은 영상 끝까지 닿아야 합니다.',
  )

  return lines.join('\n')
}

/* ───────────────────────── 파서 ───────────────────────── */

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t !== 'null' ? t : null
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

/** 문자열 배열로 정리한다. 빈 값·중복을 털고 상한을 건다. */
function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const s = str(item)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/**
 * 허용 목록에 없는 값은 버린다.
 * 자유 서술을 그대로 받으면 같은 뜻이 다섯 가지 말로 쌓여 통계가 안 된다.
 */
function oneOf(v: unknown, allowed: readonly string[]): string | null {
  const s = str(v)
  return s && allowed.includes(s) ? s : null
}

function pickList(v: unknown, allowed: readonly string[], max: number): string[] {
  return strList(v, max).filter((s) => allowed.includes(s))
}

function parseBeats(v: unknown): MediaBeat[] {
  if (!Array.isArray(v)) return []
  const out: MediaBeat[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const t = str(row.t)
    const what = str(row.what)
    if (!t || !what) continue
    out.push({ t, what })
    if (out.length >= 24) break
  }
  return out
}

/** 코드펜스·앞뒤 잡담을 걷어내고 JSON 본문만 꺼낸다. */
export function extractJsonBlock(raw: string): string | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

const TRANSCRIPT_MAX = 20_000

/**
 * 모델 응답을 읽는다. 형식이 깨졌으면 null을 돌려준다 —
 * 반쯤 읽어 반쯤 저장하면 화면이 무엇을 믿어야 할지 알 수 없게 된다.
 */
export function parseUnderstanding(raw: string): MediaUnderstanding | null {
  const block = extractJsonBlock(raw)
  if (!block) return null

  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(block)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const transcript = str(obj.transcript)

  return {
    transcript: transcript ? transcript.slice(0, TRANSCRIPT_MAX) : null,
    onScreenText: strList(obj.onScreenText, 80),
    beats: parseBeats(obj.beats),
    hookDevice: oneOf(obj.hookDevice, HOOK_DEVICES),
    hookMessage: str(obj.hookMessage),
    ending: str(obj.ending),
    cutCount: int(obj.cutCount),
    pacing: oneOf(obj.pacing, PACING_VALUES),
    shotTypes: pickList(obj.shotTypes, SHOT_TYPES, 8),
    aspect: oneOf(obj.aspect, ASPECT_VALUES),
    hasSubtitle: bool(obj.hasSubtitle),
    subtitleStyle: str(obj.subtitleStyle),
    audioStyle: oneOf(obj.audioStyle, AUDIO_STYLES),
    setting: str(obj.setting),
    peopleCount: int(obj.peopleCount),
    topicGuess: str(obj.topicGuess),
    topicEvidence: str(obj.topicEvidence),
    whyItWorks: str(obj.whyItWorks),
    replicableFormula: str(obj.replicableFormula),
    loopable: bool(obj.loopable),
    ctaPresent: bool(obj.ctaPresent),
  }
}

/**
 * 주제 판정에 쓸 **텍스트 증거**를 만든다.
 *
 * 이것이 이 모듈이 분류 사다리에 기여하는 방식이다.
 * 사다리의 설계 원칙은 "각 단은 서로 다른 증거를 본다"인데,
 * L2(제목·설명)와 L3(AI)는 지금까지 **같은 빈 상자**를 봤다 — 숏폼에는 설명이 없으니까.
 * 여기서 나오는 것은 영상 안에서만 얻을 수 있는 완전히 다른 증거다.
 */
export function understandingToEvidenceText(u: MediaUnderstanding): string {
  const parts: string[] = []
  if (u.transcript) parts.push(`대사: ${u.transcript.slice(0, 1200)}`)
  if (u.onScreenText.length > 0) parts.push(`화면 자막: ${u.onScreenText.slice(0, 20).join(' / ')}`)
  if (u.setting) parts.push(`장소·상황: ${u.setting}`)
  if (u.topicGuess) {
    parts.push(u.topicEvidence
      ? `영상이 말하는 주제: ${u.topicGuess} (근거: ${u.topicEvidence})`
      : `영상이 말하는 주제: ${u.topicGuess}`)
  }
  return parts.join('\n')
}

/** 영상 증거가 실제로 쓸 만한가. 빈 껍데기를 증거라고 부르지 않는다. */
export function hasUsableEvidence(u: MediaUnderstanding): boolean {
  return Boolean(u.transcript) || u.onScreenText.length > 0 || Boolean(u.topicGuess)
}
