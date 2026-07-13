// Artifacts 파서 (세션 3 §2-2) — 순수 함수, 단위테스트 대상.
// 저장 개념 아님(뷰 개념): assistant 메시지 content(마크다운)에서 파생 추출한다.
// 결정적 규칙만 사용(휴리스틱 최소화) — SSOT.

export type ArtifactType = 'html' | 'code' | 'markdown' | 'svg' | 'mermaid'

export interface ArtifactBlock {
  identity: string // 버전 그룹핑 키: `${type}:${정규화 title}`
  type: ArtifactType
  language: string // 코드펜스 언어 태그 원문 ('' 허용)
  title: string // 다운로드 파일명 유추에도 사용 (sanitize 완료)
  content: string // 펜스 내부 원문
}

// 언어 → 다운로드 확장자 맵 (§2-3)
const EXT_MAP: Record<string, string> = {
  html: 'html',
  svg: 'svg',
  xml: 'xml',
  mermaid: 'mmd',
  markdown: 'md',
  md: 'md',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  css: 'css',
  scss: 'scss',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  sql: 'sql',
  java: 'java',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  cs: 'cs',
  ruby: 'rb',
  rb: 'rb',
  php: 'php',
  kotlin: 'kt',
  kt: 'kt',
  swift: 'swift',
}

/** 언어 태그 → 다운로드 확장자. 미등록은 'txt'. */
export function extForLanguage(language: string): string {
  return EXT_MAP[language.trim().toLowerCase()] ?? 'txt'
}

/** 파일명 유추/식별 정규화: `[^\w.\-]` 제거. */
function sanitizeTitle(raw: string): string {
  return raw.replace(/[^\w.\-]/g, '')
}

/** 언어 태그 → ArtifactType 판정. */
function typeForLanguage(language: string): ArtifactType {
  const lang = language.trim().toLowerCase()
  if (lang === 'html') return 'html'
  if (lang === 'svg') return 'svg'
  if (lang === 'mermaid') return 'mermaid'
  if (lang === 'markdown' || lang === 'md') return 'markdown'
  return 'code'
}

/** 펜스 첫 내용 줄의 파일명 주석에서 title 추출(있으면). 없으면 ''. */
function filenameFromComment(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0)
  if (!firstLine) return ''
  const line = firstLine.trim()
  // <!-- file.html -->
  let m = /^<!--\s*(.+?)\s*-->$/.exec(line)
  if (m) {
    const token = m[1].trim()
    if (/[.\/]/.test(token) && !/\s/.test(token)) return token.split('/').pop() ?? token
    return ''
  }
  // // file.ts  또는  # file.py
  m = /^(?:\/\/|#)\s*(\S+)$/.exec(line)
  if (m) {
    const token = m[1]
    if (token.includes('.')) return token.split('/').pop() ?? token
  }
  return ''
}

/** 승격 여부 판정 (§2-2 규칙 2). */
function shouldPromote(type: ArtifactType, content: string): boolean {
  if (type === 'html' || type === 'svg' || type === 'mermaid') return true
  const lineCount = content.split('\n').length
  if (type === 'markdown') return lineCount >= 10
  // code
  return lineCount >= 15 || content.length >= 800
}

/**
 * assistant 메시지 1건의 마크다운에서 artifact 승격 대상 블록 추출.
 * - 닫힌 코드펜스만 대상. 인라인 코드/열린 펜스는 제외.
 * - title: 파일명 주석 → 직전 헤딩 → `언어+순번` 순. sanitize 후 사용.
 */
export function extractArtifacts(markdown: string): ArtifactBlock[] {
  const lines = markdown.split('\n')
  const blocks: ArtifactBlock[] = []
  const langOrdinal: Record<string, number> = {}
  let lastHeading = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const headingMatch = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line)
    if (headingMatch) {
      lastHeading = headingMatch[1].trim()
      i++
      continue
    }
    const fenceOpen = /^(\s{0,3})(`{3,})[ \t]*([^\s`]*)[ \t]*$/.exec(line)
    if (!fenceOpen) {
      i++
      continue
    }
    // 코드펜스 시작 — 닫는 펜스 탐색
    const ticks = fenceOpen[2]
    const language = fenceOpen[3] ?? ''
    const contentLines: string[] = []
    let j = i + 1
    let closed = false
    const closeRe = new RegExp('^\\s{0,3}' + ticks[0] + '{' + ticks.length + ',}[ \\t]*$')
    while (j < lines.length) {
      if (closeRe.test(lines[j])) {
        closed = true
        break
      }
      contentLines.push(lines[j])
      j++
    }

    const headingForBlock = lastHeading
    lastHeading = '' // 헤딩은 직후 펜스 1개만 라벨링

    if (!closed) {
      // 열린 펜스 — 제외하고 이후 라인은 일반 처리 재개
      i++
      continue
    }

    const content = contentLines.join('\n')
    const type = typeForLanguage(language)
    if (shouldPromote(type, content)) {
      const langKey = (language || 'code').toLowerCase()
      langOrdinal[langKey] = (langOrdinal[langKey] ?? 0) + 1
      const fromComment = filenameFromComment(content)
      let rawTitle = fromComment
      if (!rawTitle && headingForBlock) rawTitle = headingForBlock
      if (!rawTitle) rawTitle = `${langKey}-${langOrdinal[langKey]}`
      const title = sanitizeTitle(rawTitle) || `${langKey}-${langOrdinal[langKey]}`
      const identity = `${type}:${title.toLowerCase()}`
      blocks.push({ identity, type, language, title, content })
    }
    i = j + 1
  }

  return blocks
}

/**
 * 대화 전체(assistant 메시지 시간순)에서 identity별 버전 시퀀스 구성.
 * 같은 identity가 여러 메시지에 재등장 = 새 버전(대화 내 시간순).
 */
export function buildArtifactVersions(
  messages: { id: string; content: string; createdAt: string }[],
): Map<string, { messageId: string; block: ArtifactBlock }[]> {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const map = new Map<string, { messageId: string; block: ArtifactBlock }[]>()
  for (const msg of sorted) {
    const blocks = extractArtifacts(msg.content)
    for (const block of blocks) {
      const arr = map.get(block.identity) ?? []
      arr.push({ messageId: msg.id, block })
      map.set(block.identity, arr)
    }
  }
  return map
}
