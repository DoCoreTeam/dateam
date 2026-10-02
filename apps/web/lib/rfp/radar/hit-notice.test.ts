/**
 * 적중에 공고 정보를 붙이는 가드
 *
 * 붙이는 코드가 서버 첫 렌더에만 있었다. 훑기를 누르면 클라이언트가 GET 으로 다시 받고
 * 그 응답에는 공고 정보가 없어 **제목이 사라졌다**(실측 2026-09-30).
 * 사용자가 보기에는 「훑었더니 목록이 망가졌다」다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attachNotices, toNotice, NOTICE_COLS, bidClosed, type NoticeDbClient } from './hit-notice.ts'
import { stripComments } from '../../ui/component-scan.ts'

function db(rows: Record<string, unknown>[], asked: { cols?: string; ids?: string[] } = {}): NoticeDbClient {
  return {
    from: () => ({
      select: (cols: string) => ({
        in: async (_k: string, ids: string[]) => {
          asked.cols = cols
          asked.ids = ids
          return { data: rows }
        },
      }),
    }),
  }
}

test('적중에 제목과 발주처와 예산과 공고일이 붙는다', async () => {
  const asked: { cols?: string; ids?: string[] } = {}
  const out = await attachNotices(db([{
    id: 's1', title: '데이터 플랫폼 구축', announcing_agency: '한국전력',
    budget_amount: '1200000000', notice_date: '2026-09-01',
  }], asked), [{ source_id: 's1', id: 'h1' }])

  assert.equal(out.length, 1)
  assert.equal(out[0].notice?.title, '데이터 플랫폼 구축')
  assert.equal(out[0].notice?.agency, '한국전력')
  assert.equal(out[0].notice?.budgetAmount, 1_200_000_000, '글자로 온 금액을 숫자로 안 바꿨다')
  assert.equal(out[0].notice?.noticeDate, '2026-09-01')
  assert.equal(out[0].id, 'h1', '원래 적중 값이 사라졌다')
  assert.deepEqual(asked.ids, ['s1'])
})

test('같은 공고를 두 번 안 묻는다', async () => {
  const asked: { ids?: string[] } = {}
  await attachNotices(db([], asked), [
    { source_id: 's1' }, { source_id: 's1' }, { source_id: 's2' },
  ])
  assert.deepEqual(asked.ids, ['s1', 's2'])
})

test('원천이 지워진 적중도 목록에 남는다', async () => {
  // 임베드(!inner)로 읽으면 그 줄이 통째로 사라진다. 그건 「어제 본 공고가 없어짐」이다
  const out = await attachNotices(db([]), [{ source_id: 'gone', id: 'h1' }])
  assert.equal(out.length, 1, '원천이 없다고 적중을 버렸다')
  assert.equal(out[0].notice, null)
})

test('공고를 못 읽어도 적중은 돌려준다', async () => {
  const failing: NoticeDbClient = {
    from: () => ({ select: () => ({ in: async () => { throw new Error('끊김') } }) }),
  }
  const out = await attachNotices(failing, [{ source_id: 's1', id: 'h1' }])
  // 제목이 없는 목록이 목록이 없는 것보다 낫다
  assert.equal(out.length, 1)
  assert.equal(out[0].notice, null)
})

test('빈 목록이면 묻지 않는다', async () => {
  const asked: { ids?: string[] } = {}
  const out = await attachNotices(db([], asked), [])
  assert.deepEqual(out, [])
  assert.equal(asked.ids, undefined, '물을 것이 없는데 물었다')
})

test('빈 글자는 없음으로 본다', () => {
  // 빈 글자를 제목으로 두면 화면이 「제목 없음」 대신 빈 칸을 그린다
  const n = toNotice({ id: 's1', title: '   ', announcing_agency: '', budget_amount: null, notice_date: null })
  assert.equal(n.title, null)
  assert.equal(n.agency, null)
  assert.equal(n.budgetAmount, null)
})

test('읽는 칸 목록이 표에 실재하는 이름만 쓴다', () => {
  // 없는 칸을 하나라도 적으면 select 가 통째로 오류가 되고 제목이 조용히 사라진다
  const REAL = new Set(['id', 'title', 'announcing_agency', 'budget_amount', 'notice_date', 'raw',
    'demand_agency', 'estimated_price', 'bid_open_at', 'contract_method', 'award_method', 'is_urgent'])
  const unknown = NOTICE_COLS.split(',').map((c) => c.trim()).filter((c) => !REAL.has(c))
  assert.deepEqual(unknown, [], `표에 없는 칸을 읽으려 한다: ${unknown.join(', ')}`)
})

test('서버 첫 렌더와 다시 받기가 같은 함수를 쓴다', () => {
  // 한쪽만 붙이면 훑은 직후 제목이 사라진다. 그것이 이 항목의 원래 증상이다
  const page = stripComments(readFileSync(
    new URL('../../../app/(rfp)/rfp/radar/page.tsx', import.meta.url), 'utf8'))
  const route = stripComments(readFileSync(
    new URL('../../../app/api/rfp/radar/route.ts', import.meta.url), 'utf8'))

  for (const [name, src] of [['서버 첫 렌더', page], ['GET 창구', route]] as const) {
    assert.match(src, /\battachNotices\s*\(/, `${name} 가 공고를 안 붙인다`)
  }
  // 붙이는 코드를 화면 쪽에 다시 적으면 두 벌이 되고 한쪽만 고쳐진다
  assert.doesNotMatch(page, /announcing_agency/, '화면이 공고 칸을 직접 읽는다 — 붙이는 코드가 두 벌이다')
})

test('제목이 없을 때 내부 번호를 화면에 안 찍는다', () => {
  const ui = stripComments(readFileSync(
    new URL('../../../components/rfp/RadarRules.tsx', import.meta.url), 'utf8'))
  // uuid 를 찍으면 사용자는 그것을 공고 이름으로 읽고 그 줄이 무엇인지 영영 모른다
  assert.doesNotMatch(ui, /notice\?\.title\s*\?\?\s*h\.source_id/, '제목 자리에 내부 번호를 찍는다')
  assert.match(ui, /RFP_RADAR\.noticeNoTitle/, '제목이 없을 때 쓸 말이 없다')
})


// 원문으로 가는 길 — I02

test('적중에 공고 원문 주소가 함께 붙는다', async () => {
  // 케이스를 만들어야만 원문을 볼 수 있으면 판단하려고 먼저 비용을 치르는 셈이 된다
  const u = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01746331'
  const out = await attachNotices(db([{ id: 's1', title: 'ㄱ', raw: { bidNtceUrl: u } }]), [{ source_id: 's1' }])
  assert.equal(out[0].notice?.url, u)
})

test('기관 사이트에서 온 공고의 주소도 붙는다', async () => {
  const u = 'https://www.kisa.or.kr/403/form?postSeq=10849'
  const out = await attachNotices(db([{ id: 's1', title: 'ㄱ', raw: { url: u } }]), [{ source_id: 's1' }])
  assert.equal(out[0].notice?.url, u)
})

test('주소가 없거나 못 쓰는 것이면 null 이다', async () => {
  // 눌러도 갈 데가 없다는 뜻이고, 화면은 그 사실을 말해야 한다
  for (const raw of [undefined, {}, { url: '' }, { bidNtceUrl: 'javascript:alert(1)' }]) {
    const out = await attachNotices(db([{ id: 's1', title: 'ㄱ', raw }]), [{ source_id: 's1' }])
    assert.equal(out[0].notice?.url, null, `${JSON.stringify(raw)} 에서 주소가 나왔다`)
  }
})

test('목록 화면이 제목을 원문으로 보낸다', () => {
  const src = stripComments(readFileSync(
    new URL('../../../components/rfp/RadarRules.tsx', import.meta.url), 'utf8'))
  assert.match(src, /href=\{h\.notice\.url\}/, '제목이 원문으로 안 간다')
  // 바깥으로 나가는 링크다. opener 로 우리 탭 주소를 바꿀 수 있는 자리다
  assert.match(src, /rel=\{EXTERNAL_LINK_PROPS\.rel\}/, '바깥 링크에 rel 이 없다')
  assert.match(src, /target=\{EXTERNAL_LINK_PROPS\.target\}/, '새 탭으로 안 연다')
  // 주소를 손으로 적으면 한 자리에서 rel 이 빠진다
  assert.doesNotMatch(src, /rel="noopener"/, '링크 속성을 손으로 적었다')
  // 주소가 없으면 누를 수 없어야 한다
  assert.match(src, /h\.notice\?\.url \?/, '주소가 없어도 링크로 그린다')
  assert.match(src, /noticeNoUrl/, '왜 못 누르는지 안 말한다')
})

test('공고 모양을 화면이 따로 적지 않는다', () => {
  // 두 벌로 두면 서버가 칸을 늘려도 화면 쪽 모양이 안 따라오고, 그 사실은 값이 안 뜰 때에야 드러난다
  const src = stripComments(readFileSync(
    new URL('../../../components/rfp/RadarRules.tsx', import.meta.url), 'utf8'))
  assert.match(src, /notice\?:\s*HitNotice\s*\|\s*null/, '화면이 공고 모양을 따로 적었다')
})

// 판단에 필요한 것 — I03

test('판단에 쓰는 칸이 목록에 실린다', async () => {
  // 표에 537건씩 차 있는데 화면은 네 칸만 보여 주고 있었다
  const out = await attachNotices(db([{
    id: 's1', title: 'ㄱ', announcing_agency: '조달청', demand_agency: '한국전력',
    budget_amount: 1000, estimated_price: 900, bid_open_at: '2026-10-10T14:00:00Z',
    contract_method: '일반경쟁', award_method: '협상에 의한 계약', is_urgent: true, raw: {},
  }]), [{ source_id: 's1' }])
  const n = out[0].notice
  assert.equal(n?.demandAgency, '한국전력')
  assert.equal(n?.estimatedPrice, 900)
  assert.equal(n?.bidOpenAt, '2026-10-10T14:00:00Z')
  assert.equal(n?.contractMethod, '일반경쟁')
  assert.equal(n?.awardMethod, '협상에 의한 계약')
  assert.equal(n?.urgent, true)
})

test('없는 값은 null 로 두고 지어내지 않는다', async () => {
  const out = await attachNotices(db([{ id: 's1', title: 'ㄱ' }]), [{ source_id: 's1' }])
  const n = out[0].notice
  assert.equal(n?.demandAgency, null)
  assert.equal(n?.estimatedPrice, null)
  assert.equal(n?.bidOpenAt, null)
  assert.equal(n?.urgent, false, '긴급인지 모르는 것을 긴급으로 읽으면 안 된다')
})

test('개찰이 지났으면 지났다고 한다', () => {
  const 지금 = Date.UTC(2026, 9, 2)
  assert.equal(bidClosed('2026-10-01T10:00:00Z', 지금), true)
  assert.equal(bidClosed('2026-10-10T10:00:00Z', 지금), false)
})

test('개찰 시각을 모르면 지났다고 하지 않는다', () => {
  // 모르는 것을 단정하면 멀쩡한 공고를 숨기게 된다
  const 지금 = Date.UTC(2026, 9, 2)
  assert.equal(bidClosed(null, 지금), false)
  assert.equal(bidClosed('', 지금), false)
  assert.equal(bidClosed('날짜아님', 지금), false)
})

test('목록 줄이 없는 값에 빈칸을 안 그린다', () => {
  // 「-」를 늘어놓으면 「없음」과 「못 받음」이 같아 보이고 줄만 길어진다
  const src = stripComments(readFileSync(
    new URL('../../../components/rfp/RadarRules.tsx', import.meta.url), 'utf8'))
  assert.match(src, /noticeFacts\(/, '사실 줄을 한곳에서 안 만든다')
  assert.doesNotMatch(src, /noticeAgency\} \{h\.notice\?\.agency \?\? '-'\}/, '없는 값에 빈칸을 그린다')
  // 수요기관이 발주처와 같으면 두 번 말하지 않는다
  assert.match(src, /demandAgency !== n\.agency/, '같은 기관을 두 번 말한다')
})
