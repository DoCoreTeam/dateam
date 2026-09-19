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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AI_DOC_NAV, AI_PACKAGES, AI_SETUP, AI_INTRO, AI_CONTRACT_FIELDS, AI_CAPABILITY_DOCS,
  AI_LAYER_CHECKS, AI_API, AI_PROVIDERS, AI_CHAIN_LIMITS, AI_CONTRACT_TYPE, AI_STATUS_ROWS,
} from '../api-docs/ai-layer.ts'
import * as AI_DOC from '../api-docs/ai-layer.ts'
import { AI_CAPABILITIES, canTransition, type AiValueStatus } from '@ax/ai-core'
import { GEMINI, CLAUDE, OPENAI, GROQ, GROK } from '@ax/ai-providers'
import { MAX_CHAIN_CANDIDATES, MAX_PER_PROVIDER } from '../ai-chat/model-chain.ts'

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
  assert.ok(AI_CONTRACT_FIELDS.length >= 8, `계약 표가 ${AI_CONTRACT_FIELDS.length}자리뿐이다`)
  assert.ok(AI_LAYER_CHECKS.length >= 1, '확인 명령이 없다')
  assert.ok(exportsOf('@ax/ai-core').has('newAiValue'), '수출 읽기가 깨졌다')
})

/* ── 아래는 v0.10.163~ 에서 늘어난 내용을 센다 ──────────────────────────────── */

const PKG_DIR: Record<string, string> = {
  '@ax/ai-core': 'ai-core',
  '@ax/ai-gateway': 'ai-gateway',
  '@ax/ai-providers': 'ai-providers',
  '@ax/ai-react': 'ai-react',
}

/** 그 패키지 소스 전부를 한 덩이로. index.ts 하나만 보면 선언이 어디 있는지 모른다 */
function sourceOf(pkgName: string): string {
  const dir = join(PKG, PKG_DIR[pkgName], 'src')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

/**
 * 여러 줄 선언과 기본값 표기를 문서가 쓰는 한 줄 물음표 표기로 맞춘다.
 *
 * 소스는 읽기 좋게 줄을 나누고 `x: T = 기본값` 으로 적지만, 문서는 부르는 쪽이 보는
 * 모양인 `x?: T` 로 적는다. 그 차이만 흡수하고 이름·순서·타입이 달라지면 잡는다.
 */
function normalizeSignature(sig: string): string {
  let t = sig.replace(/\s+/g, ' ').trim()
  t = t.replace(/,\s*\)/g, ')').replace(/\(\s+/g, '(')
  t = t.replace(/([A-Za-z_$][\w$]*)\??: ([^,()]*(?:\([^()]*\))?[^,()]*?) = [^,()]*?(?=[,)])/g, '$1?: $2')
  return t.replace(/\s+/g, ' ')
}

/** 소스에서 그 함수의 선언 한 줄을 뽑는다. 없으면 null */
function declarationOf(pkgName: string, fnName: string): string | null {
  const src = sourceOf(pkgName)
  const m = new RegExp(`export (?:async )?function (${fnName}\\b)`).exec(src)
  if (!m) return null
  const from = m.index + m[0].length - m[1].length
  const end = src.indexOf(' {', src.indexOf(')', from))
  if (end < 0) return null
  return normalizeSignature(src.slice(from, end))
}

test('★ 안내가 적은 시그니처가 실제 선언과 같다', () => {
  /*
    이름만 맞고 인자가 틀리면 읽은 사람은 컴파일 오류로 알게 된다. 그것도 늦지만,
    인자 순서만 바뀐 경우에는 컴파일이 통과하고 런타임에 틀린 값이 들어간다.
  */
  const wrong: string[] = []
  for (const a of AI_API) {
    const real = declarationOf(a.pkg, a.name)
    if (real === null) { wrong.push(`${a.pkg} 에 ${a.name} 선언이 없다`); continue }
    const said = normalizeSignature(a.signature)
    if (real !== said) wrong.push(`${a.name}\n    소스: ${real}\n    안내: ${said}`)
  }
  assert.deepEqual(wrong, [], ['개발자센터가 틀린 호출 모양을 알려 준다:', ...wrong].join('\n  '))
})

test('★ 시그니처를 적은 이름이 수출 목록에도 있다', () => {
  // 둘이 갈리면 화면의 「그 밖의 수출」 칩에 같은 이름이 한 번 더 뜬다
  const stray: string[] = []
  for (const a of AI_API) {
    const pkg = AI_PACKAGES.find((p) => p.name === a.pkg)
    if (!pkg) { stray.push(`${a.name} 이 모르는 패키지 ${a.pkg} 를 든다`); continue }
    if (!pkg.exports.includes(a.name)) stray.push(`${a.pkg} 의 exports 에 ${a.name} 이 없다`)
  }
  assert.deepEqual(stray, [], stray.join('\n'))
})

test('★ 공급자 표가 벤더 명세와 같다', () => {
  // 손으로 옮겨 적으면 능력 한 칸이 바뀔 때 화면이 옛 답을 계속 보여 준다
  const real = [GEMINI, CLAUDE, OPENAI, GROQ, GROK].map((v) => ({
    id: v.id,
    keyPrefix: v.keyPrefixes.join(' '),
    vision: v.capabilities.vision,
    tools: v.capabilities.tools,
    thinking: v.capabilities.thinking,
    keyIssueUrl: v.keyIssueUrl,
  }))
  assert.deepEqual([...AI_PROVIDERS], real, '공급자 표가 vendor.ts 와 다르다')
})

test('★ 후보 상한이 코드 상수와 같다', () => {
  // 「6개까지 시도합니다」라고 적어 두고 코드가 3이면, 읽은 사람이 기다리는 시간을 잘못 잡는다
  assert.equal(AI_CHAIN_LIMITS.maxCandidates, MAX_CHAIN_CANDIDATES, '전체 후보 상한이 다르다')
  assert.equal(AI_CHAIN_LIMITS.maxPerProvider, MAX_PER_PROVIDER, '공급자당 상한이 다르다')
})

test('★ 화면 문구에 지어낸 말이 없다', () => {
  /*
    「관문」「등록부」「판 번호」는 이 저장소에서만 쓰던 말이다. 읽는 사람은 게이트웨이와
    공급자와 계약 버전으로 알고 있고, 검색해도 안 나오는 말을 문서에서 만나면 그 문서를
    믿지 않는다. 개수 제목(「패키지 넷」)은 그 수가 바뀌는 날 거짓이 된다.

    파일 주석이 아니라 **화면에 나가는 값**만 본다. 이 규칙 자체가 그 말들을 적어야 해서다.
  */
  const BANNED = ['관문', '등록부', '패키지 넷', '능력 여덟', '형 검사', '판 번호', '사슬']
  const copy = JSON.stringify(AI_DOC)
  const hit = BANNED.filter((w) => copy.includes(w))
  assert.deepEqual(hit, [], [
    `화면 문구에 지어낸 말이 남았다: ${hit.join(', ')}`,
    '게이트웨이 · 공급자 목록 · 계약 버전 · 타입 검사 · 모델 후보 로 적는다',
  ].join('\n'))
})

test('★ 왼쪽 목록 항목마다 제목과 설명이 있다', () => {
  // 제목이 없으면 이 절만 본문부터 시작하고, 같은 페이지 안에서 다른 화면처럼 보인다
  const bare = AI_DOC_NAV.filter((n) => !n.title?.trim() || !n.description?.trim())
  assert.deepEqual(bare.map((n) => n.key), [], '제목이나 설명이 빈 항목이 있다')

  const src = readFileSync(join(WEB, 'app/develop/AiLayerSection.tsx'), 'utf8')
  assert.match(src, /PageHeader/, '화면이 PageHeader 를 안 쓴다')
  assert.match(src, /nav\.title/, '제목을 AI_DOC_NAV 에서 안 읽는다')
  assert.match(src, /nav\.description/, '설명을 AI_DOC_NAV 에서 안 읽는다')
})

test('★ 계약 표의 자리가 타입 블록과 같다', () => {
  // 타입에는 있는데 표에 없으면, 읽은 사람이 그 자리를 안 채우고 저장한다 (capability 가 그랬다)
  const inType = [...AI_CONTRACT_TYPE.text.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort()
  const inTable = AI_CONTRACT_FIELDS.map((f) => f.key).sort()
  assert.deepEqual(inTable, inType, `계약 표 [${inTable.join(', ')}] 와 타입 블록 [${inType.join(', ')}] 이 다르다`)
})

test('★ 상태 표가 canTransition 과 같다', () => {
  // 지금은 canTransition 에게 물어서 만들지만, 누가 손으로 적어 두면 그날부터 갈린다
  const wrong: string[] = []
  for (const r of AI_STATUS_ROWS) {
    const real = AI_STATUS_ROWS
      .map((x) => x.from)
      .filter((to: AiValueStatus) => canTransition(r.from, to))
    if (r.to.join(',') !== real.join(',')) {
      wrong.push(`${r.from}: 안내는 [${r.to.join(', ')}] 인데 실제는 [${real.join(', ')}]`)
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n'))
})
