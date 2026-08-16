// lib/ci/production/edit-points.ts — 편집점 판정 SSOT (순수 함수)
//
// 이 제품이 하는 일: 남의 잘된 콘텐츠에서 뽑아낸 방식을, 내 영상에 **지점으로** 찍어 준다.
// "훅을 세워라" 같은 조언은 쓸모가 없다. "0.0~2.4초를 잘라내고 2.4초에서 시작하라"여야 편집이 된다.
//
// 입력은 두 갈래다.
//  ① 신호(signals): 브라우저가 내 영상에서 뽑은 장면 전환·무음·음량 — 객관적 사실
//  ② 근거(evidence): 우리가 수집한 잘된 콘텐츠의 패턴 — 후킹 유형·길이·성공 공식
// 둘을 겹쳐 "여기를 이렇게" 를 만든다. 신호가 없으면 지점을 지어내지 않는다.

/** 브라우저 분석이 만들어 내는 관측 신호. 모두 초 단위. */
export interface VideoSignals {
  durationSec: number
  /** 화면이 크게 바뀐 지점 */
  sceneChanges: { atSec: number; score: number }[]
  /** 소리가 거의 없는 구간 */
  silences: { startSec: number; endSec: number }[]
  /** 음량이 튀는 지점 (강조·리액션일 확률이 높다) */
  loudPeaks: { atSec: number; level: number }[]
  /**
   * 실제로 훑은 프레임 수. 0이면 화면을 못 본 것이다 —
   * 이때 "화면이 그대로입니다"라고 말하면 분석 실패를 제안으로 위장하는 셈이 된다.
   */
  framesSampled: number
  /** 오디오를 분석하지 못한 경우(무음 트랙·권한 등) */
  audioAnalyzed: boolean
  /** 소리를 못 본 이유. 화면이 "왜 소리 제안이 없는지"를 말할 수 있어야 한다 */
  audioSkipReason?: string | null
  /** 화면을 못 본 이유(교차출처 차단 등) */
  frameSkipReason?: string | null
  /**
   * 작성자가 직접 찍어 둔 구간(유튜브 설명문의 챕터).
   * 원본 픽셀을 못 읽는 링크 경로에서 **유일하게 확실한 구조 신호**다 —
   * 우리가 추정한 게 아니라 만든 사람이 적어 둔 것이라 신뢰도가 높다.
   */
  chapters?: { atSec: number; label: string }[]
}

/** 우리가 수집한 "잘된 방식". 없으면 없는 대로 동작한다. */
export interface SuccessEvidence {
  /** 잘된 콘텐츠의 길이 중앙값(초). 없으면 null */
  medianDurationSec: number | null
  /** 가장 많이 통한 후킹 유형들 */
  topHookTypes: string[]
  /** 승격된 성공 공식 문장 */
  patternStatements: string[]
  /** 근거가 된 콘텐츠 수 — 숫자를 밝혀야 사용자가 믿을지 말지 정한다 */
  sampleSize: number
}

export type EditPointKind =
  | 'hook'        // 도입부를 여기서 시작
  | 'trim'        // 잘라낼 구간
  | 'cut'         // 컷 전환을 넣을 지점
  | 'emphasis'    // 자막·확대 등 강조
  | 'length'      // 전체 길이 조정
  | 'structure'   // 구성 — 작성자가 찍은 구간(챕터)을 근거로 한 제안

export interface EditPoint {
  kind: EditPointKind
  startSec: number
  endSec: number | null
  /** 무엇을 하라 — 편집툴에서 그대로 실행 가능한 지시 */
  action: string
  /** 왜 — 관측한 신호와 수집한 근거. 지어낸 말은 넣지 않는다 */
  reason: string
  /** 0~1. 신호가 뚜렷할수록 높다 */
  confidence: number
}

/** 초 → 편집툴 타임코드(mm:ss.mmm). 편집 프로그램에 그대로 입력할 수 있어야 한다. */
export function toTimecode(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const ms = Math.round((safe - Math.floor(safe)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const base = `${pad(m)}:${pad(s)}.${pad(ms, 3)}`
  return h > 0 ? `${pad(h)}:${base}` : base
}

/** 도입부에서 잘라낼 만한 무음. 이 이상이면 "붙잡기 전에 흘려보낸 시간"이다. */
export const HOOK_DEAD_AIR_SEC = 0.8
/** 이 이상 이어지는 무음은 중간에서도 늘어짐으로 본다. */
export const MID_SILENCE_SEC = 1.5
/** 컷 없이 이 시간을 넘기면 지루해진다(숏폼 기준). */
export const MAX_STATIC_SEC = 4
/** 실제 길이가 잘된 길이보다 이 비율 이상 길면 줄이라고 말한다. */
export const LENGTH_OVER_RATIO = 1.3

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 도입부 편집점 — 첫 화면에서 붙잡지 못하면 나머지는 보지 않는다.
 * 시작 직후의 무음을 잘라내고, 첫 강조 지점을 훅으로 끌어올린다.
 */
function hookPoints(s: VideoSignals, e: SuccessEvidence): EditPoint[] {
  const out: EditPoint[] = []

  const lead = s.silences.find((x) => x.startSec <= 0.3)
  if (lead && lead.endSec - lead.startSec >= HOOK_DEAD_AIR_SEC) {
    out.push({
      kind: 'trim',
      startSec: round(lead.startSec),
      endSec: round(lead.endSec),
      action: `시작 ${toTimecode(lead.endSec)}까지 잘라내고 여기서 시작하세요`,
      reason: `첫 ${round(lead.endSec - lead.startSec)}초가 무음입니다. 도입부의 빈 시간은 이탈을 만듭니다`,
      confidence: 0.9,
    })
  }

  // 훅으로 쓸 만한 첫 강조 지점: 도입 10초 안에서 가장 큰 음량 피크
  const earlyPeak = s.loudPeaks
    .filter((p) => p.atSec <= 10)
    .sort((a, b) => b.level - a.level)[0]

  if (earlyPeak) {
    const hookLabel = e.topHookTypes.length > 0
      ? `잘 된 콘텐츠에서 가장 많이 통한 후킹은 ${e.topHookTypes.slice(0, 2).join('·')}입니다`
      : '가장 강한 순간을 앞으로 당기면 초반 이탈이 줄어듭니다'
    out.push({
      kind: 'hook',
      startSec: round(earlyPeak.atSec),
      endSec: null,
      action: `${toTimecode(earlyPeak.atSec)} 구간을 맨 앞으로 당겨 훅으로 쓰세요`,
      reason: `도입 10초 안에서 소리가 가장 크게 튀는 지점입니다. ${hookLabel}`,
      confidence: 0.7,
    })
  }

  return out
}

/** 중간 늘어짐 — 긴 무음은 잘라내고, 컷 없이 오래 가는 구간엔 컷을 넣는다. */
function pacingPoints(s: VideoSignals): EditPoint[] {
  const out: EditPoint[] = []

  for (const sil of s.silences) {
    if (sil.startSec <= 0.3) continue // 도입부는 hookPoints가 다룬다
    const len = sil.endSec - sil.startSec
    if (len < MID_SILENCE_SEC) continue
    out.push({
      kind: 'trim',
      startSec: round(sil.startSec),
      endSec: round(sil.endSec),
      action: `${toTimecode(sil.startSec)}~${toTimecode(sil.endSec)} 무음 ${round(len)}초를 줄이세요`,
      reason: '말이 끊긴 구간입니다. 이 길이의 정적은 넘김으로 이어집니다',
      confidence: 0.8,
    })
  }

  // 장면이 오래 안 바뀌는 구간에 컷 제안.
  // 화면을 실제로 훑었을 때만 말한다 — 못 본 것과 안 바뀐 것은 다르다.
  if (s.framesSampled <= 0) return out

  const marks = [0, ...s.sceneChanges.map((c) => c.atSec), s.durationSec].sort((a, b) => a - b)
  for (let i = 1; i < marks.length; i += 1) {
    const gap = marks[i] - marks[i - 1]
    if (gap <= MAX_STATIC_SEC) continue
    const at = marks[i - 1] + gap / 2
    out.push({
      kind: 'cut',
      startSec: round(at),
      endSec: null,
      action: `${toTimecode(at)}쯤에 컷·화면 전환을 넣으세요`,
      reason: `${toTimecode(marks[i - 1])}부터 ${round(gap)}초 동안 화면이 그대로입니다`,
      confidence: 0.6,
    })
  }

  return out
}

/** 강조 — 소리가 튀는 지점은 자막·확대가 들어갈 자리다. */
function emphasisPoints(s: VideoSignals): EditPoint[] {
  return s.loudPeaks
    .filter((p) => p.atSec > 10)
    .slice(0, 8)
    .map((p) => ({
      kind: 'emphasis' as const,
      startSec: round(p.atSec),
      endSec: null,
      action: `${toTimecode(p.atSec)}에 자막·확대를 넣으세요`,
      reason: '소리가 크게 튀는 지점입니다. 말의 강조점일 확률이 높습니다',
      confidence: 0.5,
    }))
}

/** 길이 — 잘된 콘텐츠의 길이와 비교한다. 근거가 없으면 말하지 않는다. */
function lengthPoint(s: VideoSignals, e: SuccessEvidence): EditPoint | null {
  if (e.medianDurationSec == null || e.sampleSize <= 0) return null
  if (s.durationSec <= e.medianDurationSec * LENGTH_OVER_RATIO) return null

  return {
    kind: 'length',
    startSec: round(e.medianDurationSec),
    endSec: round(s.durationSec),
    action: `${toTimecode(e.medianDurationSec)} 안팎으로 줄이는 것을 검토하세요`,
    reason: `지금 ${toTimecode(s.durationSec)}입니다. 잘 된 콘텐츠 ${e.sampleSize}건의 길이 중앙값은 ${toTimecode(e.medianDurationSec)}입니다`,
    confidence: 0.6,
  }
}

/** 인트로가 전체에서 이 비율을 넘으면 길다고 본다. */
export const INTRO_OVER_RATIO = 0.15
/** 비율이 커도 절대 시간이 짧으면 문제가 아니다(짧은 영상의 인트로 3초). */
export const INTRO_MIN_SEC = 20
/** 한 구간이 평균의 이 배수를 넘으면 늘어진다고 본다. */
export const LONG_SECTION_RATIO = 2.5
/** 그래도 이보다 짧으면 말하지 않는다. */
export const LONG_SECTION_MIN_SEC = 90

/**
 * 구성 편집점 — 작성자가 직접 찍은 구간(챕터)이 근거다.
 *
 * 원본 픽셀을 못 읽는 링크 경로에서 유일하게 확실한 신호다.
 * 챕터는 우리가 추정한 게 아니라 만든 사람이 적어 둔 것이라 근거로서 강하다.
 */
function chapterPoints(s: VideoSignals): EditPoint[] {
  const chapters = s.chapters ?? []
  if (chapters.length < 2 || s.durationSec <= 0) return []

  const out: EditPoint[] = []

  // ① 인트로가 긴가 — 첫 구간이 끝나는 지점이 곧 본론 시작이다
  const introEnd = chapters[1].atSec
  if (introEnd >= INTRO_MIN_SEC && introEnd > s.durationSec * INTRO_OVER_RATIO) {
    out.push({
      kind: 'structure',
      startSec: round(chapters[0].atSec),
      endSec: round(introEnd),
      action: `${toTimecode(introEnd)}까지가 인트로입니다 — 더 앞에서 본론으로 넘어가세요`,
      reason: `작성자가 찍은 구간 기준 인트로가 ${round(introEnd)}초로, 전체 ${toTimecode(s.durationSec)}의 ${Math.round((introEnd / s.durationSec) * 100)}%입니다`,
      confidence: 0.75,
    })
  }

  // ② 유난히 긴 구간 — 평균의 몇 배인지로 판단한다(절대 길이만 보면 긴 영상이 전부 걸린다)
  const spans: { start: number; end: number; label: string }[] = []
  for (let i = 0; i < chapters.length; i += 1) {
    const end = i + 1 < chapters.length ? chapters[i + 1].atSec : s.durationSec
    if (end > chapters[i].atSec) spans.push({ start: chapters[i].atSec, end, label: chapters[i].label })
  }
  if (spans.length === 0) return out

  const mean = spans.reduce((a, b) => a + (b.end - b.start), 0) / spans.length
  if (mean <= 0) return out

  for (const span of spans) {
    const len = span.end - span.start
    if (len < LONG_SECTION_MIN_SEC || len < mean * LONG_SECTION_RATIO) continue
    out.push({
      kind: 'structure',
      startSec: round(span.start),
      endSec: round(span.end),
      action: `"${span.label}" 구간(${round(len)}초)을 나누거나 줄이세요`,
      reason: `다른 구간 평균 ${round(mean)}초의 ${(len / mean).toFixed(1)}배입니다. 한 구간이 길면 그 안에서 이탈이 납니다`,
      confidence: 0.6,
    })
  }

  return out
}

/** 편집점 상한 — 100개를 던지면 아무것도 못 고친다. */
export const MAX_EDIT_POINTS = 24

/**
 * 신호 + 근거 → 편집점.
 * 신호가 비면 결과도 빈다. "일단 뭐라도 제안"하지 않는다.
 */
export function buildEditPoints(s: VideoSignals, e: SuccessEvidence): EditPoint[] {
  if (!Number.isFinite(s.durationSec) || s.durationSec <= 0) return []

  const all = [
    ...hookPoints(s, e),
    ...pacingPoints(s),
    ...emphasisPoints(s),
    ...chapterPoints(s),
  ]
  const len = lengthPoint(s, e)
  if (len) all.push(len)

  // 확신도 높은 순 → 같은 확신도면 앞선 시각 순
  all.sort((a, b) => (b.confidence - a.confidence) || (a.startSec - b.startSec))
  return all.slice(0, MAX_EDIT_POINTS)
}

/** 편집툴에 붙여넣을 지시서. 사람이 읽고 그대로 실행할 수 있어야 한다. */
export function toEditSheet(points: EditPoint[], title: string): string {
  if (points.length === 0) {
    return `${title}\n\n분석에서 제안할 편집점을 찾지 못했습니다.`
  }
  const byTime = [...points].sort((a, b) => a.startSec - b.startSec)
  const lines = byTime.map((p) => {
    const range = p.endSec != null
      ? `${toTimecode(p.startSec)} ~ ${toTimecode(p.endSec)}`
      : toTimecode(p.startSec)
    return `[${range}] ${p.action}\n    근거: ${p.reason}`
  })
  return `${title}\n\n${lines.join('\n')}`
}

/** 편집 프로그램에서 읽는 CSV(마커 가져오기용). */
export function toMarkerCsv(points: EditPoint[]): string {
  const head = 'timecode,end,kind,action'
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = [...points]
    .sort((a, b) => a.startSec - b.startSec)
    .map((p) => [
      toTimecode(p.startSec),
      p.endSec != null ? toTimecode(p.endSec) : '',
      p.kind,
      esc(p.action),
    ].join(','))
  return [head, ...rows].join('\n')
}
