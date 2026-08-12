// lib/ci/production/video-analyze.ts — 브라우저에서 영상 신호 뽑기
//
// 왜 브라우저인가: 영상 원본을 서버로 올리지 않기 위해서다.
// 파일은 사용자 기기를 벗어나지 않고, 서버로는 **숫자 신호만** 간다.
// 업로드 대기도 없고, 우리 저장소도 늘지 않는다.
//
// 오픈소스 선택 — ffmpeg.wasm을 쓰지 않은 이유:
//   장면 전환·무음 탐지는 브라우저 표준 API(Canvas/WebAudio)로 충분히 나온다.
//   ffmpeg.wasm은 30MB+ 로드에 SharedArrayBuffer용 COOP/COEP 헤더까지 요구해
//   이 화면의 번들 예산과 배포 조건을 깨뜨린다. 값을 더하지 못하는 무게는 지지 않는다.

import type { VideoSignals } from './edit-points.ts'

/** 초당 훑는 프레임 수. 촘촘할수록 정확하지만 느려진다. */
const FRAMES_PER_SEC = 2
/** 프레임 비교용 축소 크기 — 화소를 다 볼 필요는 없다. */
const SAMPLE_W = 64
const SAMPLE_H = 36
/** 이 이상 달라지면 장면이 바뀐 것으로 본다(0~1). */
const SCENE_DIFF_THRESHOLD = 0.28
/** 이 아래면 무음으로 본다(RMS). */
const SILENCE_RMS = 0.015
/** 무음으로 인정할 최소 길이. 숨 쉬는 틈까지 무음이라 하지 않는다. */
const MIN_SILENCE_SEC = 0.35
/** 평균 대비 이 배수를 넘으면 음량이 튄 것으로 본다. */
const PEAK_RATIO = 1.8
/** 분석 상한. 긴 영상 전체를 훑다 브라우저를 멈추게 하지 않는다. */
export const MAX_ANALYZE_SEC = 900

export interface AnalyzeProgress {
  phase: 'video' | 'audio' | 'done'
  /** 0~1 */
  ratio: number
}

/** 두 프레임의 밝기 히스토그램 차이(0~1). 색 대신 밝기를 쓰면 조명 변화에 덜 민감하다. */
export function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || a.length === 0) return 0
  const BINS = 16
  const ha = new Array<number>(BINS).fill(0)
  const hb = new Array<number>(BINS).fill(0)
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    const la = (a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114) / 255
    const lb = (b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114) / 255
    ha[Math.min(BINS - 1, Math.floor(la * BINS))] += 1
    hb[Math.min(BINS - 1, Math.floor(lb * BINS))] += 1
    n += 1
  }
  if (n === 0) return 0
  let diff = 0
  for (let i = 0; i < BINS; i += 1) diff += Math.abs(ha[i] - hb[i])
  // 전체 화소가 다른 구간으로 옮겨가면 diff = 2n → 0~1로 정규화
  return Math.min(1, diff / (2 * n))
}

/** RMS 창들에서 무음 구간을 만든다. 순수 함수라 테스트가 지킨다. */
export function silencesFromRms(
  rms: number[], windowSec: number,
  opts: { threshold?: number; minSec?: number } = {},
): { startSec: number; endSec: number }[] {
  const threshold = opts.threshold ?? SILENCE_RMS
  const minSec = opts.minSec ?? MIN_SILENCE_SEC
  const out: { startSec: number; endSec: number }[] = []
  let start: number | null = null

  for (let i = 0; i < rms.length; i += 1) {
    const quiet = rms[i] < threshold
    if (quiet && start === null) start = i
    if (!quiet && start !== null) {
      const s = start * windowSec
      const e = i * windowSec
      if (e - s >= minSec) out.push({ startSec: s, endSec: e })
      start = null
    }
  }
  if (start !== null) {
    const s = start * windowSec
    const e = rms.length * windowSec
    if (e - s >= minSec) out.push({ startSec: s, endSec: e })
  }
  return out
}

/** 평균 대비 크게 튀는 지점. 연속 구간은 하나로 접는다. */
export function peaksFromRms(
  rms: number[], windowSec: number, ratio = PEAK_RATIO,
): { atSec: number; level: number }[] {
  const voiced = rms.filter((v) => v >= SILENCE_RMS)
  if (voiced.length === 0) return []
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length
  if (mean <= 0) return []

  const out: { atSec: number; level: number }[] = []
  let lastIdx = -Infinity
  for (let i = 0; i < rms.length; i += 1) {
    if (rms[i] < mean * ratio) continue
    // 1초 안의 연속 피크는 같은 사건으로 본다
    if ((i - lastIdx) * windowSec < 1) continue
    out.push({ atSec: i * windowSec, level: Math.min(1, rms[i]) })
    lastIdx = i
  }
  return out
}

async function analyzeAudio(
  file: File, onProgress?: (p: AnalyzeProgress) => void,
): Promise<{ silences: VideoSignals['silences']; loudPeaks: VideoSignals['loudPeaks']; ok: boolean }> {
  try {
    const buf = await file.arrayBuffer()
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return { silences: [], loudPeaks: [], ok: false }

    const ctx = new Ctx()
    const audio = await ctx.decodeAudioData(buf)
    const ch = audio.getChannelData(0)
    const windowSec = 0.05
    const win = Math.max(1, Math.floor(audio.sampleRate * windowSec))

    const rms: number[] = []
    for (let i = 0; i + win <= ch.length; i += win) {
      let sum = 0
      for (let j = 0; j < win; j += 1) sum += ch[i + j] * ch[i + j]
      rms.push(Math.sqrt(sum / win))
      if (rms.length % 400 === 0) {
        onProgress?.({ phase: 'audio', ratio: (i / ch.length) })
      }
    }
    void ctx.close()

    return {
      silences: silencesFromRms(rms, windowSec),
      loudPeaks: peaksFromRms(rms, windowSec),
      ok: true,
    }
  } catch {
    // 오디오 트랙이 없거나 코덱을 못 여는 경우 — 영상 분석은 계속한다
    return { silences: [], loudPeaks: [], ok: false }
  }
}

/**
 * 영상 파일에서 편집 신호를 뽑는다. 파일은 브라우저 밖으로 나가지 않는다.
 * 실패한 축은 비운 채로 돌려준다 — 못 본 것을 본 것처럼 만들지 않는다.
 */
export async function analyzeVideoFile(
  file: File, onProgress?: (p: AnalyzeProgress) => void,
): Promise<VideoSignals> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('영상을 열지 못했습니다'))
    })

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const scanSec = Math.min(duration, MAX_ANALYZE_SEC)

    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_W
    canvas.height = SAMPLE_H
    const g = canvas.getContext('2d', { willReadFrequently: true })

    const sceneChanges: VideoSignals['sceneChanges'] = []
    let prev: Uint8ClampedArray | null = null
    let framesSampled = 0

    if (g && scanSec > 0) {
      const step = 1 / FRAMES_PER_SEC
      for (let t = 0; t < scanSec; t += step) {
        // eslint-disable-next-line no-await-in-loop
        const seeked = await seekTo(video, t)
        if (!seeked) break
        g.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H)
        const frame = g.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data
        framesSampled += 1
        if (prev) {
          const d = frameDiff(prev, frame)
          if (d >= SCENE_DIFF_THRESHOLD) sceneChanges.push({ atSec: t, score: d })
        }
        prev = frame
        if (framesSampled % 10 === 0) onProgress?.({ phase: 'video', ratio: t / scanSec })
      }
    }

    const audio = await analyzeAudio(file, onProgress)
    onProgress?.({ phase: 'done', ratio: 1 })

    return {
      durationSec: duration,
      sceneChanges,
      silences: audio.silences,
      loudPeaks: audio.loudPeaks,
      framesSampled,
      audioAnalyzed: audio.ok,
    }
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
}

/** seek 완료를 기다린다. 실패하면 false — 무한 대기하지 않는다. */
function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false) }, 3000)
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    function onSeeked() { cleanup(); resolve(true) }
    function onError() { cleanup(); resolve(false) }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = t
  })
}
