import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentsOf, fileNameOf, withExtension, downloadAttachment, MAX_SLOTS } from './attachments.ts'

test('공고 행에서 첨부를 뽑는다 — 이게 없어서 사람이 다시 내려받아 다시 올렸다', () => {
  const rows = attachmentsOf({
    ntceSpecDocUrl1: 'https://x.go.kr/a.hwp', ntceSpecFileNm1: '제안요청서.hwp',
    ntceSpecDocUrl2: 'https://x.go.kr/b.pdf', ntceSpecFileNm2: '과업내용서.pdf',
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].fileName, '제안요청서.hwp')
})

test('중간이 비어도 뒤를 읽는다 — 1번이 없다고 2번이 없는 게 아니다', () => {
  const rows = attachmentsOf({ ntceSpecDocUrl3: 'https://x.go.kr/c.hwp' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].slot, 3)
  assert.ok(MAX_SLOTS >= 10)
})

test('이름이 없으면 주소 끝을 쓴다 — 이름 없는 파일은 화면에서 구분이 안 된다', () => {
  const [row] = attachmentsOf({ ntceSpecDocUrl1: 'https://x.go.kr/files/%EA%B3%B5%EA%B3%A0.hwp' })
  assert.equal(row.fileName, '공고.hwp')
})

test('주소에도 이름이 없으면 자리 번호를 쓴다', () => {
  const [row] = attachmentsOf({ ntceSpecDocUrl1: 'https://x.go.kr/download?id=3' })
  assert.equal(row.fileName, '첨부1')
  assert.equal(fileNameOf('https://x.go.kr/download?id=3'), null)
})

test('확장자가 없으면 content-type 으로 붙인다 — 종류 판정이 확장자를 본다', () => {
  assert.equal(withExtension('첨부1', 'application/pdf'), '첨부1.pdf')
  assert.equal(withExtension('첨부1', 'application/x-hwp; charset=utf-8'), '첨부1.hwp')
  assert.equal(withExtension('이미.hwp', 'application/pdf'), '이미.hwp')
  assert.equal(withExtension('몰라', null), '몰라')
})

/** fetch 응답 흉내 — headers 는 반드시 get() 을 갖는다(퍼뜨리기로 덮으면 사라진다) */
function reply(headers: Record<string, string> = {}, arrayBuffer?: () => Promise<ArrayBuffer>) {
  return {
    ok: true, status: 200,
    headers: { get: (k: string) => headers[k] ?? null },
    arrayBuffer: arrayBuffer ?? (async () => new Uint8Array([1, 2, 3]).buffer),
  } as unknown as Response
}

test('크기를 헤더로 먼저 본다 — 다 받고 거절하면 거절 한 번에 그만큼 쓴다', async () => {
  let downloaded = false
  const r = await downloadAttachment({ fileName: 'a.pdf', url: 'https://x', slot: 1 }, {
    maxBytes: 10,
    fetchImpl: async () => reply(
      { 'content-length': '999999' },
      async () => { downloaded = true; return new ArrayBuffer(999999) },
    ),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'too_large')
  assert.equal(downloaded, false)
})

test('헤더가 없으면 받고 나서 잰다', async () => {
  const r = await downloadAttachment({ fileName: 'a.pdf', url: 'https://x', slot: 1 }, {
    maxBytes: 2,
    fetchImpl: async () => reply({}),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'too_large')
})

test('0바이트는 실패다 — 빈 파일이 파이프라인을 막는다', async () => {
  const r = await downloadAttachment({ fileName: 'a.pdf', url: 'https://x', slot: 1 }, {
    maxBytes: 100,
    fetchImpl: async () => reply({}, async () => new ArrayBuffer(0)),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'empty')
})

test('받으면 이름과 바이트를 준다', async () => {
  const r = await downloadAttachment({ fileName: '첨부1', url: 'https://x', slot: 1 }, {
    maxBytes: 100,
    fetchImpl: async () => reply({ 'content-type': 'application/pdf' }),
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.fileName, '첨부1.pdf')
    assert.equal(r.bytes.byteLength, 3)
  }
})

test('실패는 값으로 돌려준다 — 첨부 하나 때문에 케이스가 죽으면 안 된다', async () => {
  const r = await downloadAttachment({ fileName: 'a', url: 'https://x', slot: 1 }, {
    maxBytes: 100,
    fetchImpl: async () => ({ ok: false, status: 404 } as Response),
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.reason, 'http_error')
})
