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
