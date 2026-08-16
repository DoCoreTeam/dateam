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
/**
 * 프레임 비교용 축소 크기 — 화소를 다 볼 필요는 없다.
 * 긴 변을 이 값에 맞추고 짧은 변은 **원본 비율을 따라간다**.
 * 예전에는 64×36(16:9)로 고정해 세로 영상(쇼츠 9:16)을 눕혀 찌그러뜨렸다.
 */
const SAMPLE_LONG_EDGE = 64
const SAMPLE_MIN_EDGE = 16

/**
 * 소리 분석용 샘플레이트.
 * 왜 낮추는가: `decodeAudioData`는 **압축을 푼 PCM 전체**를 메모리에 올린다.
 * 48kHz 스테레오 1시간이면 1GB를 넘어 브라우저가 그대로 죽었다(영상 상한 900초는
 * 화면 훑기에만 걸려 있어 소리에는 아무 제동이 없었다).
 * 우리가 소리에서 보는 것은 무음과 음량 피크뿐이라 16kHz면 충분하고, 메모리는 1/3이 된다.
 */
export const AUDIO_ANALYZE_RATE = 16_000

/**
 * 소리 분석을 시도할 최대 원본 크기.
 * 압축 원본을 통째로 메모리에 올려야 디코딩이 시작되므로, 여기서 한 번 더 막는다.
 * 넘으면 화면 분석만 하고 **소리는 못 봤다고 말한다** — 조용히 빈 결과를 주지 않는다.
 */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024
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
/** 영상이 열릴 때까지 기다리는 한계. 넘으면 못 연 것으로 보고 이유를 말한다. */
export const MEDIA_OPEN_TIMEOUT_MS = 15_000
/**
 * 한 번의 탐색(seek)을 기다리는 한계.
 * 로컬 파일은 즉시지만 **주소로 읽을 때는 서버 왕복이 들어간다** — 3초는 첫 탐색조차 못 끝낸다
 * (실측: 드라이브 스트림에서 장면 전환이 통째로 '미확보'로 나왔다. 같은 영상이 파일로는 5회였다).
 */
export const SEEK_TIMEOUT_MS = 10_000
/**
 * 탐색이 연달아 이만큼 실패하면 화면 분석을 접는다.
 * 한 번 실패했다고 즉시 접으면, 네트워크가 한 번 튄 것만으로 화면 신호 전체를 버린다.
 */
export const MAX_CONSECUTIVE_SEEK_FAILS = 3

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

/** 크기 초과를 사유까지 실어 위로 올리기 위한 표식. 문구 비교로 분기하지 않는다. */
const TOO_LARGE = 'AUDIO_TOO_LARGE:'

/** 바이트 → "N MB" 표기. 사유 문구를 한 곳에서 만든다. */
function tooLargeReason(bytes: number): string {
  return `원본이 ${Math.round(bytes / 1024 / 1024)}MB라 소리는 분석하지 않았습니다 (${MAX_AUDIO_BYTES / 1024 / 1024}MB까지)`
}

interface AudioResult {
  silences: VideoSignals['silences']
  loudPeaks: VideoSignals['loudPeaks']
  ok: boolean
  /** 못 본 이유. 화면이 "왜 소리 제안이 없는지"를 말할 수 있어야 한다 */
  skipReason: string | null
}

/** 낮은 샘플레이트로 컨텍스트를 연다. 못 열면 기본 레이트로 물러선다(정확도보다 동작 우선). */
function openAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  try {
    return new Ctx({ sampleRate: AUDIO_ANALYZE_RATE })
  } catch {
    try { return new Ctx() } catch { return null }
  }
}

async function analyzeAudio(
  load: () => Promise<ArrayBuffer>,
  sizeHint: number | null,
  onProgress?: (p: AnalyzeProgress) => void,
): Promise<AudioResult> {
  if (sizeHint != null && sizeHint > MAX_AUDIO_BYTES) {
    return { silences: [], loudPeaks: [], ok: false, skipReason: tooLargeReason(sizeHint) }
  }
  try {
    const buf = await load()
    const ctx = openAudioContext()
    if (!ctx) return { silences: [], loudPeaks: [], ok: false, skipReason: '이 브라우저는 소리 분석을 지원하지 않습니다' }

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
      skipReason: null,
    }
  } catch (e) {
    // 오디오 트랙이 없거나 코덱을 못 여는 경우 — 영상 분석은 계속한다
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith(TOO_LARGE)) {
      return {
        silences: [], loudPeaks: [], ok: false,
        skipReason: tooLargeReason(Number(message.slice(TOO_LARGE.length)) || 0),
      }
    }
    const memory = e instanceof RangeError || /allocat|memory/i.test(message)
    return {
      silences: [], loudPeaks: [], ok: false,
      skipReason: memory
        ? '영상이 너무 커서 소리는 분석하지 못했습니다'
        : '소리 트랙을 열지 못했습니다',
    }
  }
}

/**
 * 원본 비율을 지키는 샘플 크기. 세로 영상을 눕히지 않는다.
 * 밝기 히스토그램만 비교하므로 크기는 작아도 되지만, **비율은 원본을 따라야** 한다.
 */
export function sampleSize(w: number, h: number): { w: number; h: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: SAMPLE_LONG_EDGE, h: Math.round(SAMPLE_LONG_EDGE * 9 / 16) }
  }
  const scale = SAMPLE_LONG_EDGE / Math.max(w, h)
  return {
    w: Math.max(SAMPLE_MIN_EDGE, Math.round(w * scale)),
    h: Math.max(SAMPLE_MIN_EDGE, Math.round(h * scale)),
  }
}

interface MediaSource {
  /** `<video src>`에 넣을 주소 */
  playbackUrl: string
  /** 소리 분석용 원본 바이트. 못 얻으면 null을 주면 소리는 건너뛴다 */
  loadBytes: (() => Promise<ArrayBuffer>) | null
  sizeHint: number | null
  /** 다 쓰고 정리 */
  release: () => void
}

/**
 * 실제 분석 본체. 파일이든 주소든 여기로 모인다 —
 * 두 벌로 나뉘면 한쪽만 고쳐지고 다른 쪽은 낡은 채로 남는다.
 */
async function analyzeMedia(
  source: MediaSource, onProgress?: (p: AnalyzeProgress) => void,
): Promise<VideoSignals> {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  // 교차출처 주소라도 상대가 허용하면 픽셀을 읽을 수 있게 미리 밝힌다.
  // (같은 출처면 아무 영향이 없고, 허용 안 하면 어차피 못 읽는다)
  video.crossOrigin = 'anonymous'
  video.src = source.playbackUrl

  try {
    await openMedia(video)

    // 길이를 모르면 분석이 성립하지 않는다. 0으로 밀고 나가면 편집점이 빈 채로 나와
    // "제안할 게 없다"처럼 보인다 — 못 읽은 것을 괜찮은 것처럼 말하지 않는다.
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('영상 길이를 읽지 못했습니다. 다른 형식(MP4)으로 다시 시도해 주세요')
    }
    const scanSec = Math.min(duration, MAX_ANALYZE_SEC)

    const size = sampleSize(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const g = canvas.getContext('2d', { willReadFrequently: true })

    const sceneChanges: VideoSignals['sceneChanges'] = []
    let prev: Uint8ClampedArray | null = null
    let framesSampled = 0
    let frameSkipReason: string | null = null

    if (g && scanSec > 0) {
      await waitForFirstFrame(video, SEEK_TIMEOUT_MS)
      const step = 1 / FRAMES_PER_SEC
      let seekFails = 0
      for (let t = 0; t < scanSec; t += step) {
        // eslint-disable-next-line no-await-in-loop
        const seeked = await seekTo(video, t)
        if (!seeked) {
          seekFails += 1
          if (seekFails >= MAX_CONSECUTIVE_SEEK_FAILS) {
            if (framesSampled === 0) {
              frameSkipReason = '영상을 훑는 데 실패했습니다 — 소리만 분석했습니다'
            }
            break
          }
          continue
        }
        seekFails = 0
        let frame: Uint8ClampedArray
        try {
          g.drawImage(video, 0, 0, size.w, size.h)
          frame = g.getImageData(0, 0, size.w, size.h).data
        } catch {
          // 교차출처 영상이 CORS를 허용하지 않으면 캔버스가 오염돼 픽셀을 못 읽는다.
          // 이건 브라우저 규칙이라 우회할 수 없다 — 못 봤다고 말하고 소리만 이어간다.
          frameSkipReason = '이 주소는 화면을 읽도록 허용하지 않습니다 (소리만 분석했습니다)'
          break
        }
        framesSampled += 1
        if (prev) {
          const d = frameDiff(prev, frame)
          if (d >= SCENE_DIFF_THRESHOLD) sceneChanges.push({ atSec: t, score: d })
        }
        prev = frame
        if (framesSampled % 10 === 0) onProgress?.({ phase: 'video', ratio: t / scanSec })
      }
    }

    const audio = source.loadBytes
      ? await analyzeAudio(source.loadBytes, source.sizeHint, onProgress)
      : { silences: [], loudPeaks: [], ok: false, skipReason: '이 주소에서는 소리를 가져올 수 없습니다' }
    onProgress?.({ phase: 'done', ratio: 1 })

    return {
      durationSec: duration,
      sceneChanges,
      silences: audio.silences,
      loudPeaks: audio.loudPeaks,
      framesSampled,
      audioAnalyzed: audio.ok,
      audioSkipReason: audio.skipReason,
      frameSkipReason,
    }
  } finally {
    video.src = ''
    source.release()
  }
}

/**
 * 영상 파일에서 편집 신호를 뽑는다. 파일은 브라우저 밖으로 나가지 않는다.
 * 실패한 축은 비운 채로 돌려준다 — 못 본 것을 본 것처럼 만들지 않는다.
 */
export async function analyzeVideoFile(
  file: File, onProgress?: (p: AnalyzeProgress) => void,
): Promise<VideoSignals> {
  const objectUrl = URL.createObjectURL(file)
  return analyzeMedia({
    playbackUrl: objectUrl,
    loadBytes: () => file.arrayBuffer(),
    sizeHint: file.size,
    release: () => URL.revokeObjectURL(objectUrl),
  }, onProgress)
}

/**
 * 주소로 분석한다. 파일이 손에 없어도 되는 경로다.
 *
 * 우리 스트리밍 경로(`/api/ci/assets/…/file`)는 같은 출처라 화면·소리 모두 읽힌다.
 * 외부 주소는 상대 서버가 CORS를 허용해야 하고, 허용하지 않으면
 * 읽지 못한 축을 **비운 채로** 돌려준다(그 사유도 함께).
 */
export async function analyzeVideoUrl(
  url: string, onProgress?: (p: AnalyzeProgress) => void,
): Promise<VideoSignals> {
  // 먼저 한 조각만 받아 **열리는지** 확인한다.
  // 바로 <video>에 물리면 실패해도 "형식을 확인하세요"로만 보여, 원인이 권한·삭제일 때
  // 사용자를 엉뚱한 곳으로 보낸다(실측: 드라이브에 없는 파일에서 그랬다).
  await assertReadable(url)

  return analyzeMedia({
    playbackUrl: url,
    loadBytes: async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`원본을 받지 못했습니다 (${res.status})`)
      // 본문을 읽기 **전에** 크기를 본다. 다 받고 나서 크다고 말하면 이미 늦다.
      const len = Number(res.headers.get('content-length'))
      if (Number.isFinite(len) && len > MAX_AUDIO_BYTES) {
        void res.body?.cancel()
        throw new Error(`${TOO_LARGE}${len}`)
      }
      return res.arrayBuffer()
    },
    // 주소는 크기를 미리 모른다 — 위에서 응답 헤더로 확인한다
    sizeHint: null,
    release: () => { /* 해제할 objectURL이 없다 */ },
  }, onProgress)
}

/**
 * 주소가 실제로 읽히는지 한 조각(1바이트)으로 확인한다.
 * 실패하면 **서버가 준 사유를 그대로** 올린다 — 우리가 지어낸 추측으로 덮지 않는다.
 */
async function assertReadable(url: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Range: 'bytes=0-0' } })
  } catch {
    throw new Error('영상 주소에 접근하지 못했습니다')
  }
  if (res.ok) {
    void res.body?.cancel()
    return
  }
  // 우리 API는 사유를 JSON으로 준다. 있으면 그 말을 그대로 쓴다.
  let reason: string | null = null
  try {
    const body = await res.json() as { error?: { message?: string } }
    reason = body?.error?.message ?? null
  } catch { /* JSON이 아니면 상태 코드로 말한다 */ }
  throw new Error(reason ?? `영상을 가져오지 못했습니다 (${res.status})`)
}

/**
 * 영상이 열릴 때까지 기다린다. **반드시 끝난다.**
 *
 * 왜 타임아웃이 필요한가: 브라우저가 못 여는 컨테이너를 만나면 `loadedmetadata`도
 * `error`도 오지 않는 경우가 있다(실측: MediaRecorder가 만든 webm).
 * 그러면 분석이 영원히 매달리고, 화면은 오류도 진행 표시도 없이 그대로 멈춘다 —
 * 사용자에겐 "골랐는데 아무 일도 안 일어남"이다. 기다림에는 끝이 있어야 한다.
 */
function openMedia(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('영상을 여는 데 너무 오래 걸립니다. 형식을 확인해 주세요(MP4 권장)'))
    }, MEDIA_OPEN_TIMEOUT_MS)
    function cleanup() {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
    }
    video.onloadedmetadata = () => { cleanup(); resolve() }
    video.onerror = () => { cleanup(); reject(new Error('영상을 열지 못했습니다')) }
  })
}

/**
 * 첫 프레임이 실제로 손에 들어올 때까지 기다린다.
 *
 * 왜: `loadedmetadata`는 "길이·크기를 알았다"일 뿐 **화면 데이터는 아직 없다**는 뜻이다.
 * 그 상태에서 바로 탐색하면 첫 탐색이 통째로 네트워크 왕복이 되어 시간을 다 쓴다.
 * 못 기다려도 진행한다 — 여기서 막으면 될 분석까지 막는다.
 */
function waitForFirstFrame(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { cleanup(); resolve() }
    const timer = setTimeout(done, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', done)
      video.removeEventListener('error', done)
    }
    video.addEventListener('loadeddata', done)
    video.addEventListener('error', done)
  })
}

/** seek 완료를 기다린다. 실패하면 false — 무한 대기하지 않는다. */
function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false) }, SEEK_TIMEOUT_MS)
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
