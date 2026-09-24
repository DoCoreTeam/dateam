import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digestSlot, hasDigestMaterial } from './digest-slot.ts'

const base = { hasDigest: false, memoChars: 0, segmentCount: 0, canEdit: true }

test('정리본이 있으면 결과를 그린다 — 재료를 지웠어도 이미 나온 정리는 남는다', () => {
  assert.equal(digestSlot({ ...base, hasDigest: true }), 'result')
  assert.equal(digestSlot({ ...base, hasDigest: true, canEdit: false }), 'result')
  assert.equal(digestSlot({ ...base, hasDigest: true, memoChars: 43 }), 'result')
})

test('정리본이 없고 재료가 있으면 실행 단추 한 줄만', () => {
  assert.equal(digestSlot({ ...base, memoChars: 43 }), 'run')
  assert.equal(digestSlot({ ...base, segmentCount: 3 }), 'run')
  assert.equal(digestSlot({ ...base, memoChars: 43, segmentCount: 3 }), 'run')
})

test('재료가 없으면 아무것도 안 그린다 — 눌러도 빈 정리본이 나올 뿐이다', () => {
  assert.equal(digestSlot(base), 'none')
})

test('못 돌리는 사람에게는 단추를 안 보인다 — 못 하는 일은 누르기 전에 안 보여야 한다', () => {
  assert.equal(digestSlot({ ...base, memoChars: 43, canEdit: false }), 'none')
  assert.equal(digestSlot({ ...base, segmentCount: 3, canEdit: false }), 'none')
})

test('재료 판정은 둘 중 하나만 있어도 참이다', () => {
  assert.equal(hasDigestMaterial(0, 0), false)
  assert.equal(hasDigestMaterial(1, 0), true)
  assert.equal(hasDigestMaterial(0, 1), true)
})

/*
  판정을 화면이 **실제로 쓰는지** 본다. 함수만 맞고 화면이 안 부르면 아무것도 안 고친 것이다
  — 이 저장소에서 여러 번 났던 결함이라 이름이 아니라 값이 가는 자리를 확인한다.
*/
test('정리 패널이 이 판정을 부르고, 빈 상자를 더는 안 그린다', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components/meeting/MeetingDigestPanel.tsx'),
    'utf8',
  )
  assert.match(src, /import \{ digestSlot \} from '@\/lib\/meeting\/digest-slot'/, '판정을 들여와야 한다')
  assert.match(
    src.replace(/\/\*[\s\S]*?\*\//g, ''),
    /const slot = digestSlot\(\{[^}]*hasDigest:[^}]*canEdit[^}]*\}\)/,
    '들여오기만 하고 안 부르면 화면은 그대로다 — 호출 자리와 넘기는 값을 본다',
  )
  assert.doesNotMatch(
    src,
    /<EmptyState/,
    '정리본이 없을 때 빈 상자를 그리면 아래 편집기가 다시 밀린다',
  )
})
