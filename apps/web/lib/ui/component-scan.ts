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
