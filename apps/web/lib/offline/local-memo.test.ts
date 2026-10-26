/**
 * 기기에 적는 회의 기록, 가드
 *
 * 오프라인 녹음 중에 적은 글은 연결이 돌아올 때까지 이 기기에만 있다.
 * 저장이 조용히 실패하거나 기한 규율이 `local-meeting` 과 갈리면 글을 잃거나 너무 오래 남는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCAL_MEMO_PREFIX, saveLocalMemo, readLocalMemo, removeLocalMemo, listLocalMemoIds,
  pruneLocalMemos, memoTextToHtml,
} from './local-memo.ts'
import { MAX_KEEP_DAYS } from './blob-store.ts'

function fakeStore(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

function throwingStore(): Storage {
  const s = fakeStore()
  return { ...s, get length() { return 0 }, setItem: () => { throw new Error('QuotaExceededError') } } as Storage
}

const T0 = Date.parse('2026-10-26T02:00:00Z')
const DAY = 86_400_000

test('적은 글을 저장하고 그대로 읽는다', () => {
  const s = fakeStore()
  assert.equal(saveLocalMemo('local_a', '첫 줄\n둘째 줄', s, T0), true)
  assert.equal(readLocalMemo('local_a', s, T0), '첫 줄\n둘째 줄')
  assert.ok(s.getItem(`${LOCAL_MEMO_PREFIX}local_a`), '정해진 키 밑에 둔다')
})

test('다시 저장하면 덮어쓴다, 회의마다 따로 둔다', () => {
  const s = fakeStore()
  saveLocalMemo('local_a', '하나', s, T0)
  saveLocalMemo('local_a', '하나 둘', s, T0)
  saveLocalMemo('local_b', '다른 회의', s, T0)
  assert.equal(readLocalMemo('local_a', s, T0), '하나 둘')
  assert.equal(readLocalMemo('local_b', s, T0), '다른 회의')
})

test('지우면 빈 글이고 목록에서도 빠진다', () => {
  const s = fakeStore()
  saveLocalMemo('local_a', '글', s, T0)
  saveLocalMemo('local_b', '글', s, T0)
  s.setItem('newax.pending-meetings', '[]')
  assert.deepEqual(listLocalMemoIds(s, T0).sort(), ['local_a', 'local_b'], '다른 키는 세지 않는다')
  removeLocalMemo('local_a', s)
  assert.equal(readLocalMemo('local_a', s, T0), '')
  assert.deepEqual(listLocalMemoIds(s, T0), ['local_b'])
})

test('기한은 local-meeting 과 같은 MAX_KEEP_DAYS 다', () => {
  const s = fakeStore()
  saveLocalMemo('local_a', '글', s, T0)
  const justIn = T0 + MAX_KEEP_DAYS * DAY
  const past = justIn + 1
  assert.equal(readLocalMemo('local_a', s, justIn), '글')
  assert.equal(readLocalMemo('local_a', s, past), '')
  assert.deepEqual(listLocalMemoIds(s, past), [])
  pruneLocalMemos(s, past)
  assert.equal(s.getItem(`${LOCAL_MEMO_PREFIX}local_a`), null, '기한 지난 글은 지운다')
})

test('망가진 내용은 빈 글로 읽고 죽지 않는다', () => {
  const s = fakeStore()
  s.setItem(`${LOCAL_MEMO_PREFIX}local_x`, '{not json')
  assert.equal(readLocalMemo('local_x', s, T0), '')
  assert.deepEqual(listLocalMemoIds(s, T0), [])
})

test('★ 저장소가 던지면 false 를 준다, 조용히 성공하지 않는다', () => {
  assert.equal(saveLocalMemo('local_a', '글', throwingStore(), T0), false)
  assert.equal(saveLocalMemo('', '글', fakeStore(), T0), false, '빈 id 에는 쓰지 않는다')
})

test('★ memoTextToHtml 은 태그와 따옴표를 escape 한다', () => {
  const html = memoTextToHtml('<script>alert("x")</script> & \'y\'')
  assert.equal(html, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>')
  assert.ok(!html.includes('<script'))
})

test('memoTextToHtml 은 줄마다 <p>, 사이 빈 줄은 <p></p>, 앞뒤 빈 줄은 버린다', () => {
  assert.equal(memoTextToHtml('\n\n첫째\r\n\n셋째\n\n'), '<p>첫째</p><p></p><p>셋째</p>')
  assert.equal(memoTextToHtml(''), '')
  assert.equal(memoTextToHtml('  \n \n'), '', '글이 없으면 빈 본문을 만들지 않는다')
})
