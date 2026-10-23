import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableFileName, isMachineFileName } from './source-label.ts'

test('텔레그램 수신 이름은 기계 이름이라 null, 화면은 「파일 가져오기」로 쓴다', () => {
  assert.equal(readableFileName('1712345678-AbC9xY.pdf'), null)
  assert.equal(readableFileName('file_123.xlsx'), null)
  assert.equal(readableFileName('file_45'), null)
  assert.equal(readableFileName('uploads/1712345678-q_w-E.pdf'), null)
  assert.equal(isMachineFileName('1712345678-AbC9xY.pdf'), true)
})

test('사람이 지은 이름은 그대로, 빈 이름은 null', () => {
  assert.equal(readableFileName('gcube edge 가격표 2026.pdf'), 'gcube edge 가격표 2026.pdf')
  assert.equal(readableFileName('2026-10 단가표.xlsx'), '2026-10 단가표.xlsx')
  assert.equal(readableFileName('file_명세.pdf'), 'file_명세.pdf')
  assert.equal(readableFileName(''), null)
  assert.equal(readableFileName(null), null)
})
