/**
 * 개발자센터의 AI 공통층 안내가 코드와 갈리지 않게 한다
 *
 * **왜**: 이 저장소는 같은 실수를 이미 했다. `/develop` 이 손으로 쓴 JSX 였고 664커밋 동안
 * 한 문장도 안 바뀌어 「분당 60회」처럼 **없는 기능을 약속**하고 있었다.
 *
 * 패키지 안내는 그보다 더 빨리 썩는다. 수출 이름이 바뀌어도 화면은 옛 이름을 계속 보여 주고,
 * 읽는 사람은 **그 이름으로 import 를 쓴다.** 그러면 문서를 읽은 대가가 컴파일 오류다.
 *
 * 그래서 안내가 드는 이름을 실제 수출과 대조한다. 여기서 실패하면 고칠 곳은 둘 중 하나다 —
 * 이름이 바뀌었으면 안내를 고치고, 안내가 옳으면 수출을 되살린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AI_DOC_NAV, AI_PACKAGES, AI_SETUP, AI_INTRO, AI_CONTRACT_FIELDS, AI_CAPABILITY_DOCS,
  AI_LAYER_CHECKS,
} from '../api-docs/ai-layer.ts'
import { AI_CAPABILITIES } from '@ax/ai-core'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PKG = join(WEB, '..', '..', 'packages')

/** 패키지가 실제로 내보내는 이름 — index.ts 한 곳이 문이다 */
function exportsOf(pkgName: string): Set<string> {
  const dir = pkgName.replace('@ax/', '')
  const src = readFileSync(join(PKG, dir, 'src/index.ts'), 'utf8')
  const names = new Set<string>()
  // `export { a, type B } from './x.ts'` 와 여러 줄 목록을 함께 본다
  for (const m of src.matchAll(/^\s*(?:export\s*\{\s*)?(?:type\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/gm)) {
    names.add(m[1])
  }
  for (const m of src.matchAll(/export\s*\{\s*((?:[^}]|\n)*?)\}/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) names.add(n)
    }
  }
  return names
}

test('★ 안내가 드는 수출 이름이 실제로 있다', () => {
  const missing: string[] = []
  for (const p of AI_PACKAGES) {
    const real = exportsOf(p.name)
    for (const name of p.exports) {
      if (!real.has(name)) missing.push(`${p.name} 이 ${name} 을 안 내보낸다`)
    }
  }
  assert.deepEqual(missing, [], [
    '개발자센터가 없는 이름을 알려 준다. 읽은 사람이 그 이름으로 import 를 쓴다:',
    ...missing.map((s) => `  ${s}`),
    '이름이 바뀌었으면 lib/api-docs/ai-layer.ts 를 고치고, 안내가 옳으면 수출을 되살린다',
  ].join('\n'))
})

test('★ 안내에 적은 패키지가 실제로 있다', () => {
  const gone = AI_PACKAGES.filter((p) => !existsSync(join(PKG, p.name.replace('@ax/', ''), 'package.json')))
  assert.deepEqual(gone.map((p) => p.name), [], '없는 패키지를 안내한다')
})

test('★ 기대는 것이 실제 의존과 같다', () => {
  // 「기대는 것 없음」이라고 적어 두고 실제로는 기대면, 받는 쪽이 하나만 설치하고 깨진다
  const wrong: string[] = []
  for (const p of AI_PACKAGES) {
    const dir = p.name.replace('@ax/', '')
    const m = JSON.parse(readFileSync(join(PKG, dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const real = Object.keys(m.dependencies ?? {}).filter((d) => d.startsWith('@ax/')).sort()
    const said = [...p.dependsOn].sort()
    if (real.join(',') !== said.join(',')) {
      wrong.push(`${p.name}: 안내는 [${said.join(', ')}] 인데 실제는 [${real.join(', ')}]`)
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n'))
})

test('★ 능력 여덟이 계약과 같은 여덟이다', () => {
  // 화면에만 새 능력이 생기거나 계약에만 생기면, 둘 중 하나는 거짓말을 한다
  const said = AI_CAPABILITY_DOCS.map((c) => c.key).sort()
  const real = [...AI_CAPABILITIES].sort()
  assert.deepEqual(said, real, `안내 [${said.join(', ')}] 와 계약 [${real.join(', ')}] 이 다르다`)
})

test('★ 왼쪽 목록의 항목이 화면에서 전부 그려진다', () => {
  /*
    목록에 있는데 그리는 가지가 없으면 눌러도 소개 화면이 뜬다 —
    빈 화면보다 나쁘다. 「왜 안 바뀌지」가 되기 때문이다.
  */
  const src = readFileSync(join(WEB, 'app/develop/AiLayerSection.tsx'), 'utf8')
  const undrawn = AI_DOC_NAV.filter((n) => !src.includes(`'${n.key}'`))
  assert.deepEqual(undrawn.map((n) => n.key), [],
    `목록에 있는데 화면이 안 그린다: ${undrawn.map((n) => n.key).join(', ')}`)
})

test('★ 화면이 안내를 손으로 들지 않는다', () => {
  // 화면에 설명을 직접 적으면 두 벌이 되고, 코드가 바뀌어도 그 쪽은 안 바뀐다
  const src = readFileSync(join(WEB, 'app/develop/AiLayerSection.tsx'), 'utf8')
  assert.match(src, /from '@\/lib\/api-docs\/ai-layer'/, '안내 표를 안 읽는다')
  for (const name of ['AI_INTRO', 'AI_SETUP', 'AI_PACKAGES', 'AI_CONTRACT_FIELDS']) {
    assert.ok(src.includes(name), `${name} 을 안 쓴다 — 그 부분을 화면이 직접 들고 있을 수 있다`)
  }
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 표가 비면 위 검사 전부가 «위반 없음» 으로 통과한다
  assert.ok(AI_PACKAGES.length >= 4, `패키지 안내가 ${AI_PACKAGES.length}개뿐이다`)
  assert.ok(AI_SETUP.length >= 5, `붙이는 순서가 ${AI_SETUP.length}단계뿐이다`)
  assert.ok(AI_INTRO.length >= 3, `소개가 ${AI_INTRO.length}덩이뿐이다`)
  assert.equal(AI_CONTRACT_FIELDS.length, 7, '계약은 일곱이다')
  assert.ok(AI_LAYER_CHECKS.length >= 1, '확인 명령이 없다')
  assert.ok(exportsOf('@ax/ai-core').has('newAiValue'), '수출 읽기가 깨졌다')
})
