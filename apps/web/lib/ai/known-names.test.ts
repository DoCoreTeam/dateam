/**
 * 이름 목록을 읽는 자리가 호출을 막지 않는지 본다
 *
 * **왜**: 가림은 더 좋아지는 것이지 문을 닫는 장치가 아니다.
 * 이름을 못 읽었다고 AI 호출이 멈추면, 가림을 붙인 것이 기능을 깨뜨린 셈이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namesForNote, namesFromDirectory, MAX_KNOWN_NAMES, type NameReader } from './known-names.ts'

function noteDb(attendees: unknown): NameReader {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { attendees } }) }) }),
    }),
  }
}

function peopleDb(rows: unknown): NameReader {
  return {
    from: () => ({
      select: () => ({ is: () => ({ limit: async () => ({ data: rows }) }) }),
    }),
  }
}

const broken: NameReader = { from: () => { throw new Error('DB 가 죽었다') } }

test('회의 참석자 이름을 읽는다', async () => {
  assert.deepEqual(await namesForNote(noteDb(['김도현', '박서준']), 'n1'), ['김도현', '박서준'])
})

test('★ 이름을 못 읽어도 호출을 막지 않는다, 빈 목록으로 떨어진다', async () => {
  assert.deepEqual(await namesForNote(broken, 'n1'), [])
  assert.deepEqual(await namesFromDirectory(broken), [])
})

test('참석자가 없거나 모양이 다르면 빈 목록이다', async () => {
  assert.deepEqual(await namesForNote(noteDb(null), 'n1'), [])
  assert.deepEqual(await namesForNote(noteDb('김도현'), 'n1'), [], '배열이 아니면 안 믿는다')
})

test('두 글자 이하와 빈 값은 목록에 안 들어간다', async () => {
  const got = await namesForNote(noteDb(['김도현', '이수', '', '   ', null]), 'n1')
  assert.deepEqual(got, ['김도현'], '두 글자는 흔한 낱말과 겹쳐 가리면 뜻이 부서진다')
})

test('같은 이름이 두 번 있어도 한 번만 들어간다', async () => {
  assert.deepEqual(await namesForNote(noteDb(['김도현', '김도현']), 'n1'), ['김도현'])
})

test('주소록 이름을 읽고 상한을 둔다', async () => {
  const rows = [{ name: '김도현' }, { name: '박서준' }, { name: null }]
  assert.deepEqual(await namesFromDirectory(peopleDb(rows)), ['김도현', '박서준'])
  assert.ok(MAX_KNOWN_NAMES >= 100, '상한이 너무 낮으면 가림이 거의 안 된다')
})
