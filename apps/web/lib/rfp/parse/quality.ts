/**
 * 파일 종류 판별과 파싱 품질 (설계서 3.3.4)
 *
 * ## 이름을 안 믿는 이유
 *
 * 나라장터 첨부에는 **확장자만 hwp 인 PDF** 가 실제로 있다(변환해서 올리고 이름을 안 고침).
 * 이름을 믿고 한글 파서에 넣으면 «지원하지 않는 포맷» 으로 실패하고, 사용자는
 * 「파일이 깨졌나 보다」라고 생각한다. 앞머리 바이트가 진실이다.
 *
 * ## 불일치를 «거부» 하는 것과 «고쳐서 쓰는» 것
 *
 * 우리는 **거부한다.** 조용히 고쳐 쓰면 그 파일이 왜 그런 모양인지 아무도 안 본다 —
 * 정정공고에 잘못 올라온 파일이거나, 애초에 다른 사업의 문서일 수 있다.
 */

/** 매직 바이트로 알아낸 실제 종류 */
export type DetectedKind =
  | 'hwp' | 'hwpx' | 'pdf' | 'zip' | 'ooxml' | 'odf' | 'rtf' | 'text' | 'image' | 'unknown'

/** 확장자가 가리키는 종류 */
export function kindOfExtension(fileName: string): DetectedKind {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  switch (ext) {
    case 'hwp': case 'hml': return 'hwp'
    case 'hwpx': return 'hwpx'
    case 'pdf': return 'pdf'
    case 'zip': return 'zip'
    case 'docx': case 'xlsx': case 'pptx': return 'ooxml'
    case 'odt': case 'ods': case 'odp': return 'odf'
    case 'rtf': return 'rtf'
    case 'txt': case 'csv': case 'md': case 'html': case 'htm': return 'text'
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'bmp': case 'tif': case 'tiff': return 'image'
    default: return 'unknown'
  }
}

function at(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b)
}

/** 글자 파일인지 볼 때 쓰는 제어 문자 (줄바꿈과 탭은 뺀다) */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]')

/** 앞머리 바이트로 실제 종류를 읽는다 */
export function detectKind(bytes: Uint8Array): DetectedKind {
  if (bytes.length < 4) return 'unknown'
  if (at(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (at(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'hwp'
  if (at(bytes, [0x7b, 0x5c, 0x72, 0x74])) return 'rtf'
  if (at(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image'
  if (at(bytes, [0xff, 0xd8, 0xff])) return 'image'
  if (at(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image'

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const head = Buffer.from(bytes.slice(0, 3000)).toString('latin1')
    if (head.includes('application/hwp+zip')) return 'hwpx'
    if (head.includes('word/') || head.includes('xl/') || head.includes('ppt/')) return 'ooxml'
    if (head.includes('opendocument')) return 'odf'
    return 'zip'
  }

  const head = Buffer.from(bytes.slice(0, 400)).toString('utf8')
  if (head.includes('<HWPML')) return 'hwp'
  if (head.startsWith('HWP Document File V3.00')) return 'hwp'
  if (!CONTROL_CHARS.test(head)) return 'text'
  return 'unknown'
}

export type KindCheck =
  | { ok: true; kind: DetectedKind }
  | { ok: false; reason: 'extension_mismatch' | 'unknown_kind'; declared: DetectedKind; actual: DetectedKind }

/**
 * 이름과 내용이 같은 것을 가리키는지 본다.
 *
 * 확장자가 없거나 모르는 것이면 내용을 따른다 — 이름을 안 붙였다고 거절할 이유는 없다.
 */
export function checkKind(fileName: string, bytes: Uint8Array): KindCheck {
  const actual = detectKind(bytes)
  const declared = kindOfExtension(fileName)
  if (actual === 'unknown') return { ok: false, reason: 'unknown_kind', declared, actual }
  if (declared === 'unknown') return { ok: true, kind: actual }
  if (declared === actual) return { ok: true, kind: actual }

  // hwp 라 적힌 hwpx 는 같은 계열이라 통과시킨다. hwp 라 적힌 pdf 는 다른 문서다
  if (isSameFamily(declared, actual)) return { ok: true, kind: actual }
  return { ok: false, reason: 'extension_mismatch', declared, actual }
}

function isSameFamily(a: DetectedKind, b: DetectedKind): boolean {
  const hwpFamily = new Set<DetectedKind>(['hwp', 'hwpx'])
  const zipFamily = new Set<DetectedKind>(['zip', 'ooxml', 'odf', 'hwpx'])
  if (hwpFamily.has(a) && hwpFamily.has(b)) return true
  // 확장자가 zip 인데 내용이 ooxml 인 경우는 흔하고 문제도 아니다
  if (a === 'zip' && zipFamily.has(b)) return true
  return false
}

// 품질 점수

export interface QualityInput {
  /** 글자를 건진 쪽 수 / 전체 쪽 수 */
  textPageRatio: number
  tableCount: number
  /** 이미지에서 뽑은 블록들의 평균 신뢰도. 그런 블록이 없으면 null */
  avgOcrConfidence: number | null
  sectionDepth: number
  warningCount: number
}

/**
 * 0~100. 다섯 신호를 더한다 (설계서 3.3.4)
 *
 * 가중치의 뜻
 * - 글자를 얼마나 건졌나 55점 — 나머지가 다 좋아도 글자가 없으면 리포트를 못 쓴다
 * - 표를 알아봤나 15점 — 요구사항과 예산은 대개 표에 있다
 * - 기계가 읽은 글의 신뢰도 10점 — 그런 블록이 없으면 만점(사람이 쓴 글이라 흔들림이 없다)
 * - 섹션 깊이 20점 — 깊이 1 은 제목을 못 찾아 페이지 단위로 접힌 것이라 0점
 * - 경고마다 4점 감점
 */
export function scoreQuality(s: QualityInput): number {
  const ratio = clamp01(s.textPageRatio)
  let score = ratio * 55
  score += Math.min(15, Math.max(0, s.tableCount) * 3)
  score += s.avgOcrConfidence === null ? 10 : clamp01(s.avgOcrConfidence) * 10
  score += Math.min(20, Math.max(0, s.sectionDepth - 1) * 7)
  score -= Math.min(20, Math.max(0, s.warningCount) * 4)
  return Math.round(Math.min(100, Math.max(0, score)))
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** 이 아래면 화면이 「파싱 품질 낮음」을 띄우고 재처리를 권한다 */
export const QUALITY_WARN_BELOW = 60

export function isLowQuality(score: number): boolean {
  return score < QUALITY_WARN_BELOW
}
