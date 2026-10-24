// develop-nav.ts 가드, 개발자센터 절 이동이 주소에 남는다 (P0168)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseSection, buildHref, resolveSection, hasCode, SECTIONS_WITH_CODE, DEFAULT_SECTION, REF_SECTION_IDS,
} from './develop-nav.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const KNOWN = ['start', 'gateway', 'gpu', 'crm', 'ci', 'legacy', 'ref-me', 'ref-approval', 'ref-spec', 'cli', 'demo', 'errors', 'ai-overview']
const ANCHORS = { 'crm.companies': 'crm', 'ref.me': 'ref-me', 'ref.openapi': 'ref-spec', 'gpu.products': 'gpu', 'broken.x': 'nowhere' }

test('주소가 비면 기본 절이다', () => {
  assert.deepEqual(parseSection('', '', KNOWN, ANCHORS), { section: DEFAULT_SECTION, anchor: null })
  assert.equal(DEFAULT_SECTION, 'start')
})

test('?section= 으로 절을 연다', () => {
  assert.deepEqual(parseSection('?section=crm', '', KNOWN, ANCHORS), { section: 'crm', anchor: null })
  assert.deepEqual(parseSection('?lang=python&section=ref-approval', '', KNOWN, ANCHORS), { section: 'ref-approval', anchor: null })
})

test('모르는 절은 기본 절로 간다', () => {
  assert.equal(parseSection('?section=hacker', '', KNOWN, ANCHORS).section, 'start')
  assert.equal(parseSection('?section=__proto__', '', KNOWN, ANCHORS).section, 'start')
  assert.equal(parseSection('?section=', '', KNOWN, ANCHORS).section, 'start')
})

test('옛 절 이름 ref 는 스펙 절로 간다', () => {
  assert.equal(parseSection('?section=ref', '', KNOWN, ANCHORS).section, 'ref-spec')
  assert.equal(resolveSection('ref', KNOWN), 'ref-spec')
  assert.equal(resolveSection('nope', KNOWN), null)
})

test('#엔드포인트 앵커는 그 엔드포인트가 있는 절을 연다', () => {
  assert.deepEqual(parseSection('', '#crm.companies', KNOWN, ANCHORS), { section: 'crm', anchor: 'crm.companies' })
  assert.deepEqual(parseSection('', '#ref.me', KNOWN, ANCHORS), { section: 'ref-me', anchor: 'ref.me' })
})

test('앵커와 section 이 함께 있으면 앵커의 절이 이긴다', () => {
  assert.deepEqual(parseSection('?section=crm', '#ref.openapi', KNOWN, ANCHORS), { section: 'ref-spec', anchor: 'ref.openapi' })
  assert.deepEqual(parseSection('?section=crm', '#crm.companies', KNOWN, ANCHORS), { section: 'crm', anchor: 'crm.companies' })
})

test('모르는 앵커는 버리고 section 을 따른다, 절 이름 앵커는 그 절로 간다', () => {
  assert.deepEqual(parseSection('?section=ci', '#no-such', KNOWN, ANCHORS), { section: 'ci', anchor: null })
  assert.deepEqual(parseSection('', '#broken.x', KNOWN, ANCHORS), { section: 'start', anchor: null })
  assert.deepEqual(parseSection('', '#errors', KNOWN, ANCHORS), { section: 'errors', anchor: null })
  assert.deepEqual(parseSection('', '#constructor', KNOWN, ANCHORS), { section: 'start', anchor: null })
})

test('인코딩된 값을 풀어 읽는다, 깨진 인코딩에도 던지지 않는다', () => {
  assert.deepEqual(parseSection('?section=ref%2Dme', '', KNOWN, ANCHORS), { section: 'ref-me', anchor: null })
  assert.deepEqual(parseSection('', '#crm%2Ecompanies', KNOWN, ANCHORS), { section: 'crm', anchor: 'crm.companies' })
  assert.doesNotThrow(() => parseSection('', '#%E0%A4%A', KNOWN, ANCHORS))
})

test('buildHref 는 다른 쿼리를 지키고 기본 절이면 section 을 뺀다', () => {
  assert.equal(buildHref('?lang=python', 'crm'), '?lang=python&section=crm')
  assert.equal(buildHref('?lang=python&section=crm', 'start'), '?lang=python')
  assert.equal(buildHref('?section=crm', 'start'), '')
  assert.equal(buildHref('', 'ref-me', 'ref.me'), '?section=ref-me#ref.me')
  // 만든 주소를 다시 읽으면 같은 곳이다
  const href = buildHref('?lang=go', 'gpu', 'gpu.products')
  const [q, h] = href.split('#')
  assert.deepEqual(parseSection(q, `#${h}`, KNOWN, ANCHORS), { section: 'gpu', anchor: 'gpu.products' })
})

test('언어 선택기는 코드가 있는 절에만 그린다', () => {
  assert.deepEqual([...SECTIONS_WITH_CODE].sort(), ['ci', 'crm', 'errors', 'gpu', 'legacy', 'ref-approval', 'ref-me', 'ref-spec', 'start'])
  for (const s of ['cli', 'demo', 'gateway', 'ai-overview']) assert.equal(hasCode(s), false, s)
  assert.deepEqual(REF_SECTION_IDS, ['ref-me', 'ref-approval', 'ref-spec'])
})

test('코드가 없다고 적은 절의 화면에는 언어를 따르는 예시가 없다', () => {
  // CodeTabs 와 useApiLanguage 가 고른 언어를 따르는 유일한 두 길이다
  for (const f of ['GatewaySection.tsx', 'CliGuideSection.tsx', 'DemoSection.tsx', 'AiLayerSection.tsx']) {
    const src = readFileSync(join(HERE, f), 'utf8')
    assert.ok(!/<CodeTabs\b|useApiLanguage\(/.test(src), `${f} 가 언어를 따르는 예시를 그리면 SECTIONS_WITH_CODE 에 넣는다`)
  }
})

test('화면이 주소 상태와 선택기 조건을 이 모듈에서 가져온다', () => {
  const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')
  assert.match(page, /hasCode\(activeSection\) && <ApiLangPicker \/>/)
  assert.match(page, /parseSection\(window\.location\.search, window\.location\.hash/)
  assert.match(page, /window\.history\.pushState\(/)
  assert.match(page, /addEventListener\('popstate'/)
  // 첫 렌더는 기본 절, 주소는 마운트 뒤에 읽는다
  assert.match(page, /useState<Section>\(DEFAULT_SECTION as Section\)/)
})
