import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Packer } from 'docx'
import { buildConversationDocx } from './export-docx.ts'

const conv = {
  title: '내 대화',
  provider: 'claude',
  model: 'claude-opus-4-8',
  createdAt: '2026-07-13T05:30:00Z',
}

test('buildConversationDocx: Document 생성 및 buffer 직렬화 성공(구조 오류 없음)', async () => {
  const doc = buildConversationDocx(conv, [
    { role: 'user', content: '안녕', createdAt: '2026-07-13T05:30:00Z' },
    {
      role: 'assistant',
      content: '반가워요',
      createdAt: '2026-07-13T05:30:05Z',
      citations: [{ url: 'https://a.com', title: 'A 사이트' }],
    },
  ])
  const buf = await Packer.toBuffer(doc)
  assert.ok(Buffer.isBuffer(buf))
  assert.ok(buf.length > 0)
})

test('buildConversationDocx: 메시지 없어도 제목/메타만으로 생성 가능', async () => {
  const doc = buildConversationDocx(conv, [])
  const buf = await Packer.toBuffer(doc)
  assert.ok(buf.length > 0)
})

test('buildConversationDocx: HTML 혼입 content도 예외 없이 처리(htmlToPlain 방어)', async () => {
  const doc = buildConversationDocx(conv, [
    { role: 'assistant', content: '첫줄<br/>둘째줄<p>문단</p>', createdAt: '2026-07-13T05:30:05Z' },
  ])
  const buf = await Packer.toBuffer(doc)
  assert.ok(buf.length > 0)
})
