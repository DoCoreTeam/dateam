// 회의록 복사 — 붙여넣었을 때 회의록으로 읽히는가.
//
// 재는 것: ① 문서 구조(제목·라벨-값·절 번호·글머리표)가 글자판에서도 줄로 남는가
//         ② 서식과 글자를 **같이** 담는가, 못 담으면 그 사실을 말하는가
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingExportHtml, type MeetingExportInput } from './export-html.ts'
import { copyExportDocument, exportHtmlToPlain } from './export-clipboard.ts'

const input: MeetingExportInput = {
  title: '인수인계 정리',
  meetingAtLabel: '2026-09-30 11:02',
  authorName: '김도현',
  memberAttendees: ['김도현'],
  externalAttendees: ['김태형'],
  view: 'refined',
  summary: '- 계약 1,400건 이관\n- Onedrive 백업 정리',
  decisions: '10월 2일까지 마무리',
  bodyHtml: '',
}
const DOC = buildMeetingExportHtml(input)
const PLAIN = exportHtmlToPlain(DOC)

test('문서의 말이 글자판에 다 남는다 — 붙여넣었더니 절반이 없으면 복사가 아니다', () => {
  for (const s of ['인수인계 정리', '2026-09-30 11:02', '김도현', '김태형', '계약 1,400건 이관', '10월 2일까지 마무리']) {
    assert.ok(PLAIN.includes(s), `글자판에 «${s}» 가 없습니다\n---\n${PLAIN}`)
  }
})

test('라벨과 값이 안 뭉개진다 — htmlToPlain 은 표를 모른다', () => {
  assert.match(PLAIN, /작성일시: 2026-09-30 11:02/, `라벨-값이 붙었습니다\n---\n${PLAIN}`)
  assert.match(PLAIN, /참석자: /, '참석자 라벨이 사라졌습니다')
})

test('절 번호가 제목에 붙어 나온다 — 「1회의 내용」이 아니라 「1. 회의 내용」', () => {
  assert.match(PLAIN, /1\.\s*회의 내용/, `절 번호가 제목에 붙었습니다\n---\n${PLAIN}`)
  assert.match(PLAIN, /2\.\s*결정사항/, '두 번째 절 번호가 없습니다')
})

test('글머리표가 줄로 남는다 — 목록이 한 줄로 뭉치면 회의록이 아니다', () => {
  assert.match(PLAIN, /- 계약 1,400건 이관\n- Onedrive 백업 정리/, `목록이 뭉쳤습니다\n---\n${PLAIN}`)
})

test('템플릿 들여쓰기는 지우고 사람이 쓴 들여쓰기는 남긴다 — 붙여넣으면 계단처럼 밀려 보인다', () => {
  const doc = buildMeetingExportHtml({ ...input, summary: '- 첫 줄\n    들여쓴 사람 글' })
  const plain = exportHtmlToPlain(doc)
  for (const line of plain.split('\n')) {
    assert.ok(!/^ {4,}(작성|참석|회의|결정|인수|— 이)/.test(line), `템플릿 들여쓰기가 남았습니다: «${line}»`)
  }
  assert.ok(plain.includes('    들여쓴 사람 글'), '사람이 쓴 들여쓰기를 지웠습니다')
})

test('라벨-값 사이에 빈 줄이 끼지 않는다 — 표가 표로 안 읽힌다', () => {
  assert.match(PLAIN, /작성일시: .+\n작성자: .+\n참석자: /, `표 사이에 빈 줄이 있습니다\n---\n${PLAIN}`)
})

test('스타일·제목 태그가 글자로 새지 않는다', () => {
  assert.ok(!PLAIN.includes('box-sizing'), 'CSS 가 글자로 샜습니다')
  assert.ok(!PLAIN.includes('<'), `태그가 남았습니다\n---\n${PLAIN}`)
})

test('서식과 글자를 같이 담는다 — 워드에는 표가, 메모장에는 글자가 간다', async () => {
  const got: Record<string, string>[] = []
  class FakeItem { constructor(parts: Record<string, Blob>) { got.push(Object.fromEntries(Object.keys(parts).map((k) => [k, k]))) } }
  const written: unknown[][] = []
  const nav = { clipboard: { write: async (i: unknown[]) => { written.push(i) }, writeText: async () => { throw new Error('안 불려야 한다') } } }
  const r = await copyExportDocument(DOC, nav, FakeItem as unknown as typeof ClipboardItem)
  assert.equal(r, 'rich')
  assert.deepEqual(Object.keys(got[0]), ['text/html', 'text/plain'], '두 벌을 같이 안 담았습니다')
  assert.equal(written.length, 1)
})

test('서식을 못 담는 브라우저에서는 글자만 담고 그 사실을 말한다 — 조용히 넘어가지 않는다', async () => {
  let got = ''
  const nav = { clipboard: { writeText: async (s: string) => { got = s } } }
  const r = await copyExportDocument(DOC, nav, undefined)
  assert.equal(r, 'text', '서식을 못 담았는데 담았다고 합니다')
  assert.ok(got.includes('인수인계 정리'), '글자도 안 담겼습니다')
})

test('서식 담기가 막히면 글자로 내려간다 — 아무것도 안 담기지 않게', async () => {
  let got = ''
  const nav = {
    clipboard: {
      write: async () => { throw new Error('막힘') },
      writeText: async (s: string) => { got = s },
    },
  }
  class FakeItem { constructor(_parts: Record<string, Blob>) {} }
  const r = await copyExportDocument(DOC, nav, FakeItem as unknown as typeof ClipboardItem)
  assert.equal(r, 'text')
  assert.ok(got.length > 0, '내려갔는데 글자도 안 담겼습니다')
})

test('둘 다 안 되면 던진다 — 아무 일도 안 일어났는데 성공했다고 하지 않는다', async () => {
  await assert.rejects(() => copyExportDocument(DOC, {}, undefined), /복사할 수 없습니다/)
})
