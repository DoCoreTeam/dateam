/**
 * 패키지 문서와 코드가 갈리지 않게 한다
 *
 * **왜 이 가드가 생겼나**: 이 저장소에서 README 다섯을 쓴 직후, 그 안의 예제 **셋이 틀려
 * 있었다**. `newAiValue` 는 `capability` 가 필수인데 안 적었고, 근거는 `blockId/start/end`
 * 인데 `locator` 라고 썼고, `Rung` 에 없는 `to` 를 적었다. 문서를 먼저 쓰고 서명을 안 본
 * 흔적이고, **아무 검사도 그것을 못 잡았다.**
 *
 * 문서의 예제는 읽는 사람이 **그대로 복사한다.** 틀린 예제는 안 쓰느니만 못하다 —
 * 읽은 대가가 컴파일 오류이고, 그다음부터 그 문서를 안 믿는다.
 *
 * 그래서 예제가 드는 것을 소스와 대조한다:
 *   1) import 하는 이름이 실제로 수출되는가
 *   2) 함수에 넘기는 **자리 이름**이 그 함수가 받는 것과 같은가
 *   3) 문서가 시키는 명령이 실제로 있는가
 *   4) 패키지마다 읽을 문서가 있는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const PKG = join(ROOT, 'packages')

function pkgDirs(): string[] {
  return readdirSync(PKG)
    .filter((n) => statSync(join(PKG, n)).isDirectory())
    .filter((n) => existsSync(join(PKG, n, 'package.json')))
    .sort()
}

function srcFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) { walk(f); continue }
      if (n.endsWith('.ts') || n.endsWith('.tsx')) out.push(f)
    }
  }
  walk(join(PKG, dir, 'src'))
  return out
}

function readmes(): { file: string; text: string; pkg: string | null }[] {
  const out = [{ file: 'packages/README.md', text: readFileSync(join(PKG, 'README.md'), 'utf8'), pkg: null as string | null }]
  for (const d of pkgDirs()) {
    const p = join(PKG, d, 'README.md')
    if (existsSync(p)) out.push({ file: `packages/${d}/README.md`, text: readFileSync(p, 'utf8'), pkg: d })
  }
  return out
}

/** 이 패키지가 내보내는 이름 — index.ts 한 곳이 문이다 */
function exportsOf(dir: string): Set<string> {
  const src = readFileSync(join(PKG, dir, 'src/index.ts'), 'utf8')
  const names = new Set<string>()
  for (const m of src.matchAll(/^\s*(?:export\s*\{\s*)?(?:type\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/gm)) names.add(m[1])
  for (const m of src.matchAll(/export\s*\{\s*((?:[^}]|\n)*?)\}/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) names.add(n)
    }
  }
  return names
}

test('★ 문서가 import 하는 이름이 실제로 수출된다', () => {
  const bad: string[] = []
  for (const { file, text } of readmes()) {
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@ax\/([a-z-]+)'/g)) {
      const dir = m[2]
      if (!existsSync(join(PKG, dir, 'src/index.ts'))) { bad.push(`${file}: @ax/${dir} 가 없다`); continue }
      const real = exportsOf(dir)
      for (const raw of m[1].split(',')) {
        const n = raw.trim().replace(/^type\s+/, '').trim()
        if (n && !real.has(n)) bad.push(`${file}: @ax/${dir} 가 ${n} 을 안 내보낸다`)
      }
    }
  }
  assert.deepEqual(bad, [], [
    '문서의 예제를 그대로 복사하면 컴파일이 안 된다:',
    ...bad.map((s) => `  ${s}`),
  ].join('\n'))
})

/** `export interface X { a: ...; b?: ... }` 에서 자리 이름을 뽑는다 */
function interfaceKeys(all: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const m of all.matchAll(/export\s+interface\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*\{([\s\S]*?)\n\}/g)) {
    const keys = new Set<string>()
    for (const line of m[2].split('\n')) {
      const k = /^\s{2}(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line)
      if (k) keys.add(k[1])
    }
    out.set(m[1], keys)
  }
  return out
}

/** `export function f(x: SomeInput` 에서 첫 인자의 형을 뽑는다 */
function firstParamType(all: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]*>)?\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g
  for (const m of all.matchAll(re)) out.set(m[1], m[2])
  return out
}

test('★ 예제가 넘기는 자리 이름이 실제 자리와 같다', () => {
  /*
    「그런 자리는 없다」는 컴파일러가 말해 주지만, 문서는 컴파일되지 않는다.
    실제로 `evidence: [{ quote, locator }]` 라고 적어 두고 실제 자리는
    `blockId / start / end / quote` 였다.
  */
  const all = pkgDirs().flatMap((d) => srcFiles(d).map((f) => readFileSync(f, 'utf8'))).join('\n')
  const ifaces = interfaceKeys(all)
  const paramOf = firstParamType(all)

  const bad: string[] = []
  for (const { file, text } of readmes()) {
    for (const fence of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
      const code = fence[1]
      for (const call of code.matchAll(/\b([a-z][A-Za-z0-9_]*)\(\{([\s\S]*?)\n\}\)/g)) {
        const fn = call[1]
        const typeName = paramOf.get(fn)
        if (!typeName) continue
        const keys = ifaces.get(typeName)
        if (!keys || keys.size === 0) continue
        for (const line of call[2].split('\n')) {
          const k = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
          if (k && !keys.has(k[1])) bad.push(`${file}: ${fn} 에 ${k[1]} 이라는 자리는 없다 (${typeName})`)
        }
      }
    }
  }
  assert.deepEqual(bad, [], [
    '문서의 예제가 없는 자리를 넘긴다. 읽는 사람은 그대로 복사한다:',
    ...bad.map((s) => `  ${s}`),
  ].join('\n'))
})

test('★ 문서가 시키는 명령이 실제로 있다', () => {
  // 「이걸 돌리세요」가 없는 명령이면, 처음 붙이는 사람이 첫 줄에서 막힌다
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  const web = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8')) as { scripts?: Record<string, string> }
  /*
    처음 이 규칙을 「줄 전체가 `pnpm x` 인 줄」로 잡았더니 **한 번도 안 돌았다.**
    실제 문서의 명령 줄에는 뒤에 `# 설명` 이 붙어 있어서 줄 끝 검사에 안 걸렸다.
    일부러 깨서 확인하지 않았으면 잠든 채로 통과했을 것이다.
  */
  const pkgDirNames = new Set(pkgDirs())
  const bad: string[] = []
  for (const { file, text } of readmes()) {
    for (const m of text.matchAll(/(?:^|\n|&&\s*)pnpm\s+(?!--filter|-r|dlx|install|add)([a-z][a-z:-]*)/g)) {
      const name = m[1]
      // 패키지 폴더 안에서 도는 명령은 그 패키지의 스크립트다
      const inPkg = pkgDirNames.has(file.split('/')[1] ?? '')
      const own = inPkg
        ? (JSON.parse(readFileSync(join(PKG, file.split('/')[1], 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
        : {}
      if (name in (root.scripts ?? {}) || name in own) continue
      bad.push(`${file}: pnpm ${name} 이라는 명령이 없다`)
    }
    for (const m of text.matchAll(/pnpm\s+--filter\s+web\s+([a-z][a-z:-]*)/g)) {
      if (!(m[1] in (web.scripts ?? {}))) bad.push(`${file}: pnpm --filter web ${m[1]} 이 없다`)
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'))
})

test('★ 패키지마다 읽을 문서가 있고 자기 이름을 적는다', () => {
  const bad: string[] = []
  for (const d of pkgDirs()) {
    const p = join(PKG, d, 'README.md')
    if (!existsSync(p)) { bad.push(`${d}: README 가 없다`); continue }
    const text = readFileSync(p, 'utf8')
    const name = (JSON.parse(readFileSync(join(PKG, d, 'package.json'), 'utf8')) as { name: string }).name
    if (!text.includes(name)) bad.push(`${d}: README 가 자기 이름(${name})을 안 적는다`)
    if (text.length < 500) bad.push(`${d}: README 가 너무 짧다`)
  }
  assert.ok(existsSync(join(PKG, 'README.md')), 'packages/README.md 가 없다')
  assert.deepEqual(bad, [], bad.join('\n'))
})

test('★ 패키지 문서의 설명글에 한글을 쓰지 않는다', () => {
  /*
    패키지는 우리말을 안 갖는 것이 경계다. 코드에는 그 규칙이 붙어 있었는데
    (`ai-package-boundary.test.ts`) 문서에는 없었다 — 그러면 문서부터 우리말이 되고,
    다음 사람이 「문서도 한글인데 문구 하나쯤」 하며 코드로 넘어온다.

    **예제 안은 뺀다.** 부르는 쪽이 한국어 문구를 준다는 것이 이 층의 설계라,
    그 모습을 보이려면 예제에 한국어가 들어가야 한다. 거기 있는 한글은
    «패키지가 가진 말»이 아니라 «부르는 쪽이 주는 말»이고, 둘은 정반대다.
  */
  const bad: string[] = []
  for (const { file, text } of readmes()) {
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    const han = prose.match(/[가-힣]/g)
    if (han) bad.push(`${file}: 설명글에 한글 ${han.length}자`)
  }
  assert.deepEqual(bad, [], [
    '패키지 문서의 설명글이 우리말이 됐다. 예제 안은 괜찮지만 설명은 아니다:',
    ...bad.map((s) => `  ${s}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 대상이 0이면 위 검사 전부가 «위반 없음» 으로 통과한다
  const docs = readmes()
  assert.ok(docs.length >= 5, `문서를 ${docs.length}개만 찾았다`)
  const all = pkgDirs().flatMap((d) => srcFiles(d).map((f) => readFileSync(f, 'utf8'))).join('\n')
  assert.ok(interfaceKeys(all).get('NewAiValueInput')?.has('capability'), '자리 이름 읽기가 깨졌다')
  assert.equal(firstParamType(all).get('newAiValue'), 'NewAiValueInput', '인자 형 읽기가 깨졌다')
  assert.ok(exportsOf('ai-core').has('newAiValue'), '수출 읽기가 깨졌다')
})
