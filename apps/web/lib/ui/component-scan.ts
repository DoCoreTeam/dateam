// lib/ui/component-scan.ts — UI 가드 3종이 공유하는 파일/심볼 스캐너 (SSOT)
//
// 가드마다 walk를 복붙하면 "한 가드만 고쳐서 나머지가 새 규칙을 못 보는" 일이 생긴다.
// 스캔은 여기 한 곳에만 둔다. docs/ui-system/scan-inventory.mjs와 같은 규칙을 쓴다.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist'])

/** dir 아래의 파일을 확장자로 걸러 전부 모은다 (경로는 cwd 기준 상대). */
export function walkFiles(dir: string, exts: readonly string[] = ['.tsx', '.ts']): string[] {
  const out: string[] = []
  const visit = (d: string) => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) visit(p)
      else if (exts.some((x) => e.endsWith(x))) out.push(p)
    }
  }
  visit(dir)
  return out
}

export function read(file: string): string {
  return readFileSync(file, 'utf-8')
}

/**
 * 이 `/` 가 정규식 리터럴의 시작인가.
 *
 * **왜 필요한가** (실측 2026-09-28): `s.match(/`+/g)` 처럼 정규식 안에 역따옴표가 있으면
 * 스캐너가 그것을 템플릿 문자열의 시작으로 읽고 **다음 역따옴표까지 대여섯 줄을 통째로
 * 건너뛴다.** 그 사이에 있던 주석이 코드로 남아 가드가 주석을 위반으로 보고했다.
 *
 * 나눗셈과 가르는 법은 **앞의 글자**다. 값이 끝난 자리 뒤의 `/` 는 나눗셈이고,
 * 값이 올 자리(여는 괄호·쉼표·대입·return 등) 뒤의 `/` 는 정규식이다.
 */
function isRegexStart(src: string, at: number): boolean {
  if (src[at + 1] === '/' || src[at + 1] === '*') return false
  let j = at - 1
  while (j >= 0 && /\s/.test(src[j])) j -= 1
  if (j < 0) return true
  const prev = src[j]
  if ('([{,;:=!&|?+-*%~^<>'.includes(prev)) return true
  // `return /x/` 처럼 낱말 뒤에 오는 자리. 값이 되는 낱말(식별자) 뒤는 나눗셈이다
  const word = /[\w$]+$/.exec(src.slice(0, j + 1))
  return word !== null && ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield'].includes(word[0])
}

/** 정규식 리터럴이 끝나는 자리 다음. 글자열(`[...]`) 안의 `/` 는 끝이 아니다 */
function regexEnd(src: string, at: number): number {
  let j = at + 1
  let inClass = false
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { j += 2; continue }
    if (c === '\n') return j            // 한 줄을 넘으면 정규식이 아니었다, 거기서 멈춘다
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return j + 1
    j += 1
  }
  return j
}

/**
 * 주석 제거 — 주석 속 예시(`raw <h1>을 다시 그리지 않는다` 같은 설명)를 위반으로 세지 않는다.
 * 실제로 이 처리가 없으면 "규칙을 설명한 주석" 때문에 그 파일이 위반으로 잡힌다.
 * (scripts/ui-phrases.mjs의 같은 이름 함수와 규칙이 같다 — 한쪽만 고치지 말 것)
 */
export function stripComments(src: string): string {
  const out = src.split('')
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null
      i += 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue }
    if (c === '/' && isRegexStart(src, i)) { i = regexEnd(src, i); continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1 }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (; i < stop; i += 1) if (src[i] !== '\n') out[i] = ' '
      continue
    }
    i += 1
  }
  return out.join('')
}

/** 파일이 export하는 최상위 심볼 이름들 (default export의 이름 포함). */
export function exportedSymbols(src: string): string[] {
  const names: string[] = []
  const push = (n: string) => {
    if (n && names.indexOf(n) === -1) names.push(n)
  }

  const declRe = /export\s+(?:async\s+)?(?:default\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(src)) !== null) push(m[1])

  const listRe = /export\s*\{([^}]+)\}/g
  while ((m = listRe.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const parts = part.trim().split(/\s+as\s+/)
      const name = parts[parts.length - 1].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) push(name)
    }
  }
  return names
}

/** 컴포넌트로 볼 이름인가 (PascalCase). 상수·타입 잡음을 뺀다. */
export function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name)
}

/**
 * JSX 여는 태그의 **진짜** 끝 `>` 위치. 못 찾으면 -1.
 *
 * 왜 필요한가: `<input ... onChange={(e) => f(e)} className="x" />`에서
 * `[^>]*` 류의 정규식은 **화살표 함수의 `>`를 태그 끝으로 오인**한다.
 * 그러면 뒤쪽 속성(className·type…)이 통째로 안 보여서
 * "이미 input-field가 있는데 또 붙인다" 같은 판정 사고가 난다.
 * (v0.7.460 실제 사고: 코드모드가 className을 8곳 중복 삽입하고
 *  `type="file"` 입력 2곳을 폼 필드로 오염시켰다.)
 *
 * 중괄호 깊이와 문자열/템플릿 리터럴을 건너뛰며 depth 0의 `>`만 태그 끝으로 본다.
 */
export function jsxTagEnd(src: string, from: number): number {
  let i = from
  let depth = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
    i++
  }
  return -1
}

/** 여는 태그 하나 */
export interface JsxTag {
  /** 태그 이름 (input · select · textarea …) */
  name: string
  /** 태그명 뒤 ~ 끝 `>` 앞까지의 속성 원문 */
  attrs: string
  /** 1-기반 줄 번호 */
  line: number
}

/** src 안의 여는 태그를 이름으로 골라 전부 (속성 원문과 함께) 돌려준다. */
export function findJsxTags(src: string, names: readonly string[]): JsxTag[] {
  const out: JsxTag[] = []
  const re = new RegExp(`<(${names.join('|')})\\b`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const attrStart = m.index + m[0].length
    const end = jsxTagEnd(src, attrStart)
    if (end < 0) continue
    out.push({
      name: m[1],
      attrs: src.slice(attrStart, end),
      line: src.slice(0, m.index).split('\n').length,
    })
  }
  return out
}
