/**
 * 읽기 상한은 **설정에서만 온다** — 숫자가 코드에 또 박히지 않게
 *
 * ## 왜 가드가 필요한가
 *
 * 상한을 설정으로 뺐어도, 다음 사람이 급할 때 그 자리에 숫자를 그냥 적으면
 * 설정 화면은 「40」이라고 말하는데 실제로는 다른 값이 돈다. 그때 사용자는
 * **설정을 고쳐도 아무 일이 안 일어나는** 상태를 겪고, 그 이유를 알 길이 없다.
 * 이 저장소는 그 모양의 사고를 여러 번 겪었다(값은 있는데 읽는 코드가 없다).
 *
 * ## 무엇을 붙잡나
 *
 *   ① 상한 숫자가 **선언 한 곳**에만 있다
 *   ② 설정 기본값이 그 선언을 **가리킨다**(숫자를 다시 적지 않는다)
 *   ③ 읽는 자리가 설정을 **실제로 부른다**(안 부르면 설정은 장식이다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { QUOTE_IMPORT_SETTING_KEY } from '../terms/quote.ts'
import { QUOTE_IMPORT_FALLBACK } from '../crm/services/quote-import-config.ts'
import { MAX_SOURCE_CHARS } from '../crm/services/quote-source-text.ts'
import { MAX_DOC_LINES, MAX_DOC_COMPONENT_LINES } from '../crm/ai/schemas/quote-from-doc.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

/** 상한 셋이 사는 자리 — 여기 말고 다른 곳에 같은 숫자가 또 있으면 안 된다 */
const DECLARED: Array<[string, string, number]> = [
  ['MAX_SOURCE_CHARS', 'lib/crm/services/quote-source-text.ts', MAX_SOURCE_CHARS],
  ['MAX_DOC_LINES', 'lib/crm/ai/schemas/quote-from-doc.ts', MAX_DOC_LINES],
  ['MAX_DOC_COMPONENT_LINES', 'lib/crm/ai/schemas/quote-draft.ts', MAX_DOC_COMPONENT_LINES],
]

test('★ 상한은 저마다 한 곳에서만 선언된다', () => {
  for (const [name, file] of DECLARED) {
    const src = read(file)
    const declarations = src.split(`export const ${name}`).length - 1
    assert.equal(declarations, 1, `${name} 선언이 ${file} 에 ${declarations}개다`)
  }
})

test('★ 설정 기본값이 그 선언을 가리킨다 — 숫자를 다시 적으면 두 값이 갈린다', () => {
  assert.equal(QUOTE_IMPORT_FALLBACK.maxChars, MAX_SOURCE_CHARS)
  assert.equal(QUOTE_IMPORT_FALLBACK.maxLines, MAX_DOC_LINES)
  assert.equal(QUOTE_IMPORT_FALLBACK.maxComponentLines, MAX_DOC_COMPONENT_LINES)

  const src = read('lib/crm/services/quote-import-config.ts')
  const block = src.slice(src.indexOf('QUOTE_IMPORT_FALLBACK'), src.indexOf('QUOTE_IMPORT_CEILING'))
  assert.ok(!/max(Chars|Lines|ComponentLines):\s*\d/.test(block),
    '기본값에 숫자를 직접 적었다 — 선언을 가리켜야 한다')
})

test('★ 설정 화면의 기본값도 그 값을 가리킨다', () => {
  const src = read('lib/crm/services/setting.ts')
  const block = src.slice(src.indexOf('QUOTE_IMPORT_SETTING_KEY.maxComponentLines'))
  const defs = block.slice(0, block.indexOf('] as const'))
  assert.ok(!/fallback:\s*'?\d/.test(defs), '설정 기본값에 숫자를 직접 적었다')
  assert.match(defs, /QUOTE_IMPORT_FALLBACK\./, '설정이 기본값을 안 가리킨다')
})

test('★ 읽는 자리가 설정을 실제로 부른다 — 안 부르면 설정은 장식이다', () => {
  const src = read('lib/crm/services/quote-from-file.ts')
  assert.match(src, /readQuoteImportConfig\(db\)/, '설정을 안 읽는다')
  assert.match(src, /maxChars: config\.maxChars/, '글자 수 상한이 설정을 안 따른다')
  assert.match(src, /parseQuoteFromDocDoc\(text, limits\)/, '항목·구성 상한이 설정을 안 따른다')

  // **기본값으로 부르는 자리가 남아 있으면** 설정은 그 경로에서만 안 먹는다
  assert.ok(!/irToSourceText\(parsed\.doc\)(?!,)/.test(src),
    '상한 없이 원문을 펴는 자리가 남아 있다')
})

test('★ 인쇄 설정도 화면이 아니라 문서가 들고 간다', () => {
  const src = read('lib/crm/services/quote-document.ts')
  assert.match(src, /readQuoteImportConfig\(db\)/, '문서가 설정을 안 읽는다')
  assert.match(src, /printComponents: importConfig\.printComponents/, '문서에 안 싣는다')
})

test('★ 설정 다섯이 전부 읽히는 곳이 있다 — 안 읽는 입력창은 거짓말이다', () => {
  const config = read('lib/crm/services/quote-import-config.ts')
  for (const [name, key] of Object.entries(QUOTE_IMPORT_SETTING_KEY)) {
    assert.ok(config.includes(`QUOTE_IMPORT_SETTING_KEY.${name}`), `${key} 를 아무도 안 읽는다`)
  }
})
