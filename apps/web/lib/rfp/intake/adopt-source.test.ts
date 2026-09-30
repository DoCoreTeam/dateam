import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'
import {
  HIT_STATUS, HIT_STATUSES, DEFAULT_LIST_STATUS, USER_SETTABLE, isUserSettable,
} from '../radar/hit-status.ts'
import { join } from 'node:path'

import { adoptSource, TITLE_PENDING, MAX_ATTACHMENTS, type AdoptPorts, type AdoptInput } from './adopt-source.ts'
import { sourceRowFromPreview } from './source-row.ts'
import type { NoticePreview } from './notice-preview.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')

const ATT = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ fileName: `서식${i + 1}.hwp`, url: `https://x/${i}.hwp`, slot: i + 1 }))

function input(over: Partial<AdoptInput> = {}): AdoptInput {
  return {
    sourceId: 'src-1',
    orgId: 'org-1',
    title: '차세대 시스템 구축',
    docClass: 'public',
    userId: 'user-1',
    budgetAmount: null,
    attachments: ATT(1),
    noticeUrl: 'https://notice.go.kr/a',
    emptyReason: null,
    ...over,
  }
}

function ports(over: Partial<AdoptPorts> = {}): AdoptPorts {
  return {
    findCase: async () => null,
    createCase: async () => ({ id: 'case-1' }),
    download: async (a) => ({ ok: true, fileName: a.fileName, bytes: new Uint8Array([1]), contentType: null }),
    saveFile: async () => 'saved',
    enqueueParse: async () => ({ id: 'job-1', status: 'queued' }),
    markAdopted: async () => {},
    ...over,
  }
}

test('★ 첨부가 0건이면 분석을 안 건다 — 빈 리포트는 고장보다 나쁘다', async () => {
  let enqueued = 0
  const got = await adoptSource(
    input({ attachments: [], emptyReason: 'no_attachment_on_page' }),
    ports({ enqueueParse: async () => { enqueued += 1; return { id: 'j', status: 'queued' } } }),
  )
  assert.equal('error' in got, false)
  assert.equal(enqueued, 0, '분석을 걸면 안 된다')
  assert.equal(!('error' in got) && got.attachmentReason, 'no_attachment_on_page')
  // 우리가 못 찾아도 사람이 열어 볼 주소는 준다
  assert.equal(!('error' in got) && got.noticeUrl, 'https://notice.go.kr/a')
})

test('★ 같은 공고로 두 번 만들지 않는다 — 두 번 만들면 분석 비용이 두 배다', async () => {
  let created = 0
  const got = await adoptSource(input(), ports({
    findCase: async () => ({ id: 'case-old' }),
    createCase: async () => { created += 1; return { id: 'case-new' } },
  }))
  assert.equal(created, 0)
  assert.equal(!('error' in got) && got.caseId, 'case-old')
  assert.equal(!('error' in got) && got.reused, true)
})

test('★ 첨부 하나가 실패해도 케이스는 산다 — 그 파일만 직접 올리면 된다', async () => {
  const got = await adoptSource(input({ attachments: ATT(3) }), ports({
    download: async (a) => a.slot === 2
      ? { ok: false, reason: 'http_403' }
      : { ok: true, fileName: a.fileName, bytes: new Uint8Array([1]), contentType: null },
  }))
  assert.equal(!('error' in got) && got.attached.length, 2)
  assert.deepEqual(!('error' in got) ? got.failed : null, [{ name: '서식2.hwp', reason: 'http_403' }])
  assert.ok(!('error' in got) && got.job, '받은 것이 있으니 분석은 걸린다')
})

test('같은 파일이 두 번 붙어 있는 것은 실패가 아니다', async () => {
  const got = await adoptSource(input({ attachments: ATT(2) }), ports({
    saveFile: async (f) => f.fileName === '서식2.hwp' ? 'duplicate' : 'saved',
  }))
  assert.equal(!('error' in got) && got.attached.length, 1)
  assert.equal(!('error' in got) && got.failed.length, 0)
})

test('저장이 깨지면 실패로 남긴다 — 조용히 삼키면 화면이 설명할 말이 없다', async () => {
  const got = await adoptSource(input(), ports({ saveFile: async () => ({ failed: 'storage_failed' }) }))
  assert.deepEqual(!('error' in got) ? got.failed : null, [{ name: '서식1.hwp', reason: 'storage_failed' }])
  assert.equal(!('error' in got) && got.attachmentReason, 'no_attachment')
})

test('첨부 수에 상한이 있다 — 서식이 수십 개 붙는 공고가 있다', async () => {
  let downloaded = 0
  await adoptSource(input({ attachments: ATT(30) }), ports({
    download: async (a) => { downloaded += 1; return { ok: true, fileName: a.fileName, bytes: new Uint8Array([1]), contentType: null } },
  }))
  assert.equal(downloaded, MAX_ATTACHMENTS)
})

test('이름이 없으면 자리를 비워 두지 않는다 — 분석이 진짜 사업명을 찾아 대신한다', async () => {
  let title = ''
  await adoptSource(input({ title: '   ' }), ports({
    createCase: async (c) => { title = c.title; return { id: 'case-1' } },
  }))
  assert.equal(title, TITLE_PENDING)
})

test('케이스를 못 만들면 첨부를 받지 않는다 — 갈 곳 없는 파일을 내려받을 이유가 없다', async () => {
  let downloaded = 0
  const got = await adoptSource(input(), ports({
    createCase: async () => null,
    download: async (a) => { downloaded += 1; return { ok: true, fileName: a.fileName, bytes: new Uint8Array([1]), contentType: null } },
  }))
  assert.deepEqual(got, { error: 'case_create_failed' })
  assert.equal(downloaded, 0)
})

// ── 공고 한 줄로 바꾸기 ──

const PREVIEW = (over: Partial<NoticePreview> = {}): NoticePreview => ({
  kind: 'page', url: 'https://nia.or.kr/View.do?bcIdx=29963', title: '스마트 물류 실증',
  noticeNo: null, round: null, agency: null, budgetAmount: null,
  attachments: [], reason: null, raw: null, ...over,
})

test('★ 번호가 없는 기관 공고는 주소가 열쇠다 — 두 번 봐도 같은 값이어야 한다', () => {
  const row = sourceRowFromPreview(PREVIEW(), 'org-1', '2026-09-16T00:00:00Z')
  assert.equal(row.source_system, 'agency')
  assert.equal(row.notice_no, 'https://nia.or.kr/View.do?bcIdx=29963')
  assert.equal(row.notice_round, null)
  // 첨부를 다시 찾을 때 여기서 주소를 읽는다
  assert.equal(row.raw.url, 'https://nia.or.kr/View.do?bcIdx=29963')
})

test('나라장터는 공고번호와 차수가 열쇠다', () => {
  const row = sourceRowFromPreview(PREVIEW({
    kind: 'g2b', noticeNo: '20250912345', round: 0, agency: '조달청',
    budgetAmount: 1_200_000_000, raw: { bidNtceNm: '차세대' },
  }), 'org-1', '2026-09-16T00:00:00Z')
  assert.equal(row.source_system, 'g2b')
  assert.equal(row.notice_no, '20250912345')
  assert.equal(row.notice_round, 0)
  assert.equal(row.announcing_agency, '조달청')
  assert.equal(row.raw.bidNtceNm, '차세대', '원본을 남긴다')
})

// ── 길이 한 벌인지 ──

test('★ 첨부 내려받기가 한자리에만 있다 — 두 벌이면 한쪽만 고쳐진다', () => {
  const callers = [
    'app/api/rfp/sources/[id]/adopt/route.ts',
    'app/api/rfp/cases/from-url/route.ts',
    'lib/rfp/intake/adopt-ports.ts',
  ].filter((p) => /downloadAttachment\(/.test(read(p)))
  assert.deepEqual(callers, ['lib/rfp/intake/adopt-ports.ts'])
})

test('★ 두 창구가 같은 배선을 쓴다', () => {
  for (const p of ['app/api/rfp/sources/[id]/adopt/route.ts', 'app/api/rfp/cases/from-url/route.ts']) {
    const src = read(p)
    assert.match(src, /adoptSource\(/, p)
    assert.match(src, /realAdoptPorts\(/, p)
    // 등급을 안 고르면 만들지 않는다 — 기본값을 주면 비공개 문서가 공개로 들어온다
    assert.match(src, /isDocClass\(/, p)
    assert.match(src, /missing_doc_class/, p)
    assert.match(src, /requireMemberApi\(\)/, p)
  }
})

// 케이스로 만든 적중이 목록에서 빠진다 — I01

test('케이스로 만들면 적중 상태가 표에 있는 값으로 바뀐다', () => {
  // 코드가 쓰는 낱말이 표의 CHECK 에 없으면 UPDATE 가 늘 실패하고,
  // supabase-js 는 그 실패를 던지지 않고 돌려준다. 증상은 「목록에 계속 있다」로만 나온다
  const sql = readFileSync(
    new URL('../../../../../supabase/migrations/301_rfp_radar_hit_adopted.sql', import.meta.url), 'utf8',
  ).replace(/^\s*--.*$/gm, '')

  for (const s of HIT_STATUSES) {
    assert.ok(sql.includes(`'${s}'::text`), `제약에 ${s} 가 없다`)
  }
  // 표를 만들거나 사본을 뜨지 않는다
  assert.doesNotMatch(sql, /create table/i)
})

test('담기 경로가 상수를 쓰고 오류를 읽는다', () => {
  const src = stripComments(readFileSync(new URL('./adopt-ports.ts', import.meta.url), 'utf8'))
  // 글자를 손으로 적으면 표에 없는 값을 또 쓸 수 있다
  assert.doesNotMatch(src, /status:\s*'adopted'/, '상태값을 손으로 적었다')
  assert.match(src, /HIT_STATUS\.adopted/, '상태 상수를 안 쓴다')
  // 오류를 안 읽으면 실패가 「아무 일도 안 일어남」으로 보인다
  assert.match(src, /const \{ error \}[\s\S]{0,300}?rfp_radar_hits/, '쓰기 결과를 안 받는다')
  assert.match(src, /if \(error\)/, '쓰기 오류를 안 읽는다')
})

test('목록 기본 상태는 아직 정하지 않은 것만 본다', () => {
  // 케이스가 된 것과 뺀 것이 기본 목록에 남으면 「지웠는데 그대로」가 된다
  assert.equal(DEFAULT_LIST_STATUS, HIT_STATUS.new)
  assert.notEqual(DEFAULT_LIST_STATUS, HIT_STATUS.adopted)
  assert.notEqual(DEFAULT_LIST_STATUS, HIT_STATUS.dismissed)
})

test('사람이 바꿀 수 있는 상태는 둘뿐이다', () => {
  // 케이스로 만드는 것은 담기 경로가 정한다 — 화면에서 adopted 로 못 바꾼다
  assert.deepEqual([...USER_SETTABLE].sort(), ['dismissed', 'new'])
  assert.equal(isUserSettable('adopted'), false, '화면이 케이스 상태를 지어낼 수 있다')
  assert.equal(isUserSettable('opened'), false)
  assert.equal(isUserSettable('dismissed'), true)
  assert.equal(isUserSettable('없는값'), false)
})
