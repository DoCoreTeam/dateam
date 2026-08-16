// lib/ci/production/analyzable.ts — "이 자료를 편집점 분석에 쓸 수 있나" 판정 SSOT
//
// 왜 판정을 한 곳에 두는가: 같은 질문을 세 곳이 한다 —
// 목록 API(분석 가능 표시), 스튜디오(고를 수 있는 것만 보여주기), 분석 실행(어떤 경로로 열지).
// 화면마다 따로 판단하면 "목록엔 뜨는데 고르면 안 되는" 상태가 생긴다.
//
// 판정의 핵심은 **브라우저가 원본 바이트를 읽을 수 있는가**다.
// 편집점은 화면(canvas)과 소리(WebAudio)를 직접 뜯어야 나오는데,
// 교차출처 영상은 canvas가 오염돼 픽셀을 못 읽고(HTML 표준의 origin-clean 규칙),
// 플랫폼 영상은 애초에 원본 주소가 공개되지 않는다.

/** 브라우저가 대체로 열 수 있는 컨테이너. 여기 없으면 미리 막고 이유를 말한다. */
const PLAYABLE_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg'])
/** 열 수 없는 것이 확실한 컨테이너 — "해보고 실패"보다 미리 말하는 게 낫다. */
const UNPLAYABLE_EXT = new Set(['mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mxf'])

export type AnalyzeSource =
  /** 우리 도메인을 거쳐 읽는다 — 화면·소리 전부 분석된다 */
  | { mode: 'stream'; url: string }
  /** 외부 주소를 직접 읽는다 — 상대가 CORS를 열어 줬을 때만 된다 */
  | { mode: 'direct'; url: string }
  /** 원본은 못 읽지만 길이·구성 같은 겉정보로 부분 제안은 된다 */
  | { mode: 'meta'; url: string; platform: string }
  /** 분석할 수 없다. 이유를 반드시 함께 준다 */
  | { mode: 'none'; reason: string }

export interface AnalyzeInput {
  assetId: string
  /**
   * 스트리밍 주소에 실어 보낼 워크스페이스.
   * `<video src>`·`<a href>`는 커스텀 헤더를 붙일 수 없어 `X-CI-Workspace`를 못 준다 —
   * 그래서 쿼리로 넘긴다(API가 헤더 다음 순위로 이미 허용한다).
   * 없으면 서버가 "워크스페이스를 지정해 주세요"로 400을 낸다(실측).
   */
  workspaceId: string
  sourceKind: 'file' | 'link'
  driveFileId: string | null
  sourceUrl: string | null
  mime: string | null
  /** 유튜브·틱톡 등. 플랫폼 영상은 원본을 못 읽는다 */
  platform: string | null
}

function extensionOf(url: string | null): string | null {
  if (!url) return null
  try {
    const path = new URL(url).pathname
    const m = /\.([a-z0-9]{2,4})$/i.exec(path)
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * 우리 서버를 거쳐 자료를 읽는 주소. 같은 출처라 canvas 오염도 CORS도 없다.
 * 워크스페이스를 쿼리로 싣는 이유는 `AnalyzeInput.workspaceId` 주석 참조.
 */
export function streamUrlFor(assetId: string, workspaceId: string): string {
  return `/api/ci/assets/${assetId}/file?workspaceId=${encodeURIComponent(workspaceId)}`
}

/**
 * 어떤 경로로 분석할지 정한다.
 * 판정 순서가 곧 우선순위다 — 확실히 되는 것(우리 스트림)을 먼저 본다.
 */
export function resolveAnalyzeSource(a: AnalyzeInput): AnalyzeSource {
  const ext = extensionOf(a.sourceUrl)

  if (ext && UNPLAYABLE_EXT.has(ext)) {
    return { mode: 'none', reason: `${ext.toUpperCase()} 형식은 브라우저가 열지 못합니다. MP4로 변환해 주세요` }
  }
  if (a.mime && !a.mime.startsWith('video/') && !a.driveFileId) {
    return { mode: 'none', reason: '영상 자료가 아닙니다' }
  }

  // ① 드라이브에 원본이 있으면(올린 파일이든, 드라이브 링크든) 우리 경로로 읽는다
  if (a.driveFileId) {
    return { mode: 'stream', url: streamUrlFor(a.assetId, a.workspaceId) }
  }

  // ② 플랫폼 영상 — 원본 주소가 공개되지 않는다. 겉정보로 할 수 있는 만큼만 한다
  if (a.platform && a.sourceUrl) {
    return { mode: 'meta', url: a.sourceUrl, platform: a.platform }
  }

  // ③ 직접 미디어 주소 — 상대 서버가 CORS를 열어 줬으면 된다
  if (a.sourceKind === 'link' && a.sourceUrl && ext && PLAYABLE_EXT.has(ext)) {
    return { mode: 'direct', url: a.sourceUrl }
  }

  if (a.sourceKind === 'file') {
    return { mode: 'none', reason: '예전 저장분이라 원본을 읽을 수 없습니다. 드라이브에 다시 올려 주세요' }
  }
  return { mode: 'none', reason: '이 주소에서는 영상 원본을 읽을 수 없습니다' }
}

/** 목록에서 "분석하기"를 보여줄지. mode가 none이 아니면 무엇이든 할 수 있다. */
export function isAnalyzable(a: AnalyzeInput): boolean {
  return resolveAnalyzeSource(a).mode !== 'none'
}

/** 화면에 붙일 짧은 설명. 무엇이 나오고 무엇이 안 나오는지 미리 말한다. */
export function analyzeScopeLabel(source: AnalyzeSource): string {
  switch (source.mode) {
    case 'stream': return '화면·소리 전부 분석'
    case 'direct': return '화면·소리 분석 (상대 서버가 허용할 때)'
    case 'meta': return '길이·구성만 분석 (플랫폼 영상은 원본을 못 읽습니다)'
    default: return source.reason
  }
}
