import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachmentsOf, fileNameOf, withExtension, nameFromDisposition, fixMojibake,
  downloadAttachment, MAX_SLOTS,
} from './attachments.ts'

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
test('헤더의 파일 이름을 읽는다 — 주소에 이름이 없는 첨부가 흔하다', () => {
  // 실측(NIA): 퍼센트 인코딩된 한글 이름이 filename= 으로 온다
  assert.equal(
    nameFromDisposition('attachment; filename=%EC%A0%9C%EC%95%88%EC%9A%94%EC%B2%AD%EC%84%9C.hwpx'),
    '제안요청서.hwpx',
  )
})

test('RFC 5987 filename* 이 먼저다', () => {
  const h = "attachment; filename=fallback.bin; filename*=UTF-8''%EA%B3%B5%EA%B3%A0%EC%84%9C.hwpx"
  assert.equal(nameFromDisposition(h), '공고서.hwpx')
})

test('따옴표와 빈 헤더를 견딘다', () => {
  assert.equal(nameFromDisposition('attachment; filename="a b.pdf"'), 'a b.pdf')
  assert.equal(nameFromDisposition(null), null)
  assert.equal(nameFromDisposition('attachment'), null)
})

test('헤더 이름이 주소 이름을 이긴다 — 확장자가 없으면 파싱이 통째로 죽는다', async () => {
  const r = await downloadAttachment({ fileName: '첨부1', url: 'https://x/Download.do?fileNo=1', slot: 1 }, {
    maxBytes: 100,
    fetchImpl: async () => reply({
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename=%EC%A0%9C%EC%95%88%EC%9A%94%EC%B2%AD%EC%84%9C.hwpx',
    }),
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.fileName, '제안요청서.hwpx')
})

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

test('★ 깨진 한글 파일 이름을 되돌린다 — 실측 KISA 첨부 4건이 전부 깨졌다', () => {
  // 서버가 헤더에 UTF-8 바이트를 그대로 넣어 fetch 가 Latin-1 로 읽었다
  const broken = Buffer.from('입찰공고.hwpx', 'utf8').toString('latin1')
  assert.equal(fixMojibake(broken), '입찰공고.hwpx')
})

test('멀쩡한 이름은 안 건드린다', () => {
  assert.equal(fixMojibake('제안요청서.hwpx'), '제안요청서.hwpx')
  assert.equal(fixMojibake('proposal.pdf'), 'proposal.pdf')
})

test('되돌려도 한글이 아니면 그대로 둔다 — 억지로 바꾸지 않는다', () => {
  assert.equal(fixMojibake('café.pdf'), 'café.pdf')
})

test('★ 깨져 온 헤더 이름을 고쳐서 쓴다 — 실측 KISA', async () => {
  const broken = Buffer.from('입찰공고.hwpx', 'utf8').toString('latin1')
  const r = await downloadAttachment(
    { fileName: '입찰공고(2026-222) 중소기업 AI 위협 대응.hwpx', url: 'https://x/d', slot: 1 },
    {
      maxBytes: 100,
      fetchImpl: async () => reply({
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename=${broken}`,
      }),
    },
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.fileName, '입찰공고.hwpx')
})

test('못 고치는 헤더면 링크 글자를 쓴다 — 깨진 이름을 저장하면 되돌릴 방법이 없다', async () => {
  // 되돌려도 한글이 아니면 복구가 포기한다. 그때는 링크 글자가 낫다
  const r = await downloadAttachment(
    { fileName: '제안요청서.hwpx', url: 'https://x/d', slot: 1 },
    {
      maxBytes: 100,
      fetchImpl: async () => reply({
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename=Ã¬Â Â.bin',
      }),
    },
  )
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.fileName, '제안요청서.hwpx')
})
