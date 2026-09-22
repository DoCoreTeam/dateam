/**
 * 사람 표시 — 이름 옆에 무엇이 붙나
 *
 * 규칙을 새로 만든 것이 아니라 **있는 규칙(pickTitle)을 부르는지**를 본다.
 * 여기서 규칙을 다시 적었다면 두 벌이 되고, 두 벌은 언젠가 갈린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { personDisplay, personLine, NO_NAME } from './person.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('직책이 있으면 직책이 붙는다', () => {
  // 「본부장」이 「상무」보다 상대에게 역할을 알려 준다
  const d = personDisplay({ name: '김도현', rank: '상무', position: '본부장' })
  assert.equal(d.name, '김도현')
  assert.equal(d.title, '본부장')
})

test('직책이 없으면 직급이 붙는다', () => {
  // 실측 기준 34명 중 직급은 32명이 있고 직책은 11명뿐이다. 직급이 대부분을 채운다
  const d = personDisplay({ name: '이상혁', rank: '이사', position: null })
  assert.equal(d.title, '이사')
})

test('둘 다 없으면 이름만 남는다', () => {
  const d = personDisplay({ name: '테스터' })
  assert.equal(d.title, '', '「직원」처럼 있는 척하는 말을 지어내지 않는다')
  assert.equal(personLine({ name: '테스터' }), '테스터', '빈 껍데기가 안 붙는다')
})

test('직접 지정한 직함이 조직 값을 이긴다', () => {
  // 대외 문서에 다른 직함을 쓰는 경우가 실제로 있다(겸직·대외 직함)
  const d = personDisplay({ name: '김도현', explicitTitle: '대표', rank: '상무', position: '본부장' })
  assert.equal(d.title, '대표')
})

test('공백만 있는 값은 없는 것으로 본다', () => {
  const d = personDisplay({ name: '김도현', explicitTitle: '   ', position: '  ', rank: '상무' })
  assert.equal(d.title, '상무')
})

test('이름이 없어도 멈추지 않는다', () => {
  const d = personDisplay({ name: null, rank: '사원' })
  assert.equal(d.name, NO_NAME)
  assert.equal(d.initial, NO_NAME.slice(0, 1))
  assert.equal(personLine({ name: '' }), NO_NAME)
})

test('동그라미에 넣을 글자는 이름 첫 자다', () => {
  assert.equal(personDisplay({ name: '정우재' }).initial, '정')
})

test('직함 규칙을 여기서 다시 적지 않는다', () => {
  /*
    「직접 지정 > 직책 > 직급」을 이 파일에 다시 구현하면 견적서와 화면이 갈린다.
    그래서 소스가 pickTitle 을 **부르는지**를 본다 — import 만 있고 안 부르면 안 센다.
  */
  const src = readFileSync(join(HERE, 'person.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(src, /\bpickTitle\s*\(/, 'pickTitle 을 부르지 않는다')
  assert.ok(!/position\s*\|\|\s*.*rank/.test(src), '우선순위를 여기서 다시 적었다')
})
