import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildBoard, type BoardMarketIn, type BoardQuoteIn } from './board.ts'
import { buildInquiry, inquiryOffer, mailtoHref, matchOrg, parseInquiryRecord, type InquiryOrgIn } from './inquiry.ts'
import { GPU_DEFS } from '../actions/defs/gpu.ts'

const PID = '11111111-2222-3333-4444-555555555555'
const FX = 1400

function market(id: string, name: string, usd: number, extra: Partial<BoardMarketIn> = {}): BoardMarketIn {
  return {
    id, product_id: PID, competitor_name: name, price_usd: usd, obs_currency: 'USD', obs_amount: usd, obs_gpu_count: 1,
    obs_pricing_unit: 'hour', observed_at: '2026-11-01', recorded_at: '2026-11-01', source_url: `https://${name}.example/price`, ...extra,
  }
}

function quote(id: string, name: string, usd: number): BoardQuoteIn {
  return {
    id, product_id: PID, supplier_name: name, unit_price_usd: usd, per_gpu_usd: usd, gpu_count: 1,
    original_currency: 'USD', original_price: usd, original_unit: 'USD/GPU·hr', term: '1년 약정',
    received_at: '2026-07-01', created_at: '2026-07-01', price_type: 'cost', source_format: 'mail',
  }
}

function rowOf(m: BoardMarketIn[], q: BoardQuoteIn[] = []) {
  const board = buildBoard({
    products: [{ id: PID, model_name: 'H100', memory: '80GB', gpu_count: 1, strategic_price_krw: null }],
    quotes: q, market: m, margin_pct: 20, usd_krw: FX, fx_date: '2026-11-03',
  })
  return board.rows[0]
}

const orgs: InquiryOrgIn[] = [
  { names: ['Konsttech'], supplier_id: 's1', account_id: 'a1', website: 'https://konst.example' },
  { names: ['konst tech'], supplier_id: 's2', account_id: null, website: null },
  { names: ['ソフトバンク'], supplier_id: null, account_id: null, website: 'https://softbank.example' },
]

test('가장 싼 공급사를 고른다, 단위 모름은 건너뛴다', () => {
  const row = rowOf([market('a', 'RunPod', 2), market('b', 'Verda', 1.5), market('c', 'Odd', 0.1, { price_usd: null, obs_pricing_unit: 'month', obs_currency: 'EUR' })])
  assert.equal(inquiryOffer(row)?.vendor, 'Verda')
  const inq = buildInquiry({ row, product_id: PID, org: null, contacts: [] })
  assert.match(inq?.body ?? '', /저희가 본 값: 1\.5 USD\/hour, 2026-11-01 기준/)
  assert.equal(inq?.crm_company_path, null)
})

test('값 없는 줄은 문의할 곳이 없다', () => {
  const row = rowOf([])
  assert.equal(inquiryOffer(row), null)
  assert.equal(buildInquiry({ row, product_id: PID, org: null, contacts: [] }), null)
})

test('이름 표기가 달라도 같은 곳을 찾고, CRM 회사가 이어진 쪽을 먼저 쓴다', () => {
  assert.equal(matchOrg('Konsttech', orgs)?.account_id, 'a1')
  assert.equal(matchOrg('konst tech', orgs)?.account_id, 'a1')
  assert.equal(matchOrg('SoftBank', orgs)?.website, 'https://softbank.example')
  assert.equal(matchOrg('Nowhere', orgs), null)
})

test('문의 글: 모델, 공급사, 받은 값 그대로, 연락 안 되는 담당자는 뺀다', () => {
  const row = rowOf([market('a', 'Konsttech', 2)], [quote('q', 'Konsttech', 1.8)])
  const inq = buildInquiry({
    row, product_id: PID, org: orgs[0],
    contacts: [{ name: '김', title: '팀장', email: 'kim@konst.example', phone: null }, { name: '빈칸', title: null, email: null, phone: null }],
  })
  assert.ok(inq)
  assert.equal(inq.vendor, 'Konsttech')
  assert.equal(inq.model, 'H100 80GB')
  assert.equal(inq.contacts.length, 1)
  assert.equal(inq.crm_company_path, '/crm/companies/a1')
  assert.equal(inq.supplier_id, 's1')
  assert.match(inq.subject, /H100 80GB GPU 가격과 가용 수량 문의/)
  assert.match(inq.body, /Konsttech 담당자님/)
  assert.match(inq.body, /1\.8 USD\/GPU·hr, 1년 약정, 2026-07-01 기준/)
})

test('메일 주소는 받는 사람 제목 본문을 모두 인코딩한다', () => {
  const href = mailtoHref('a+b@x.com', '제목 & 1', '줄1\n줄2')
  assert.equal(href, 'mailto:a%2Bb%40x.com?subject=%EC%A0%9C%EB%AA%A9%20%26%201&body=%EC%A4%841%0A%EC%A4%842')
})

test('기록 본문 검사: uuid, 공급사 길이, 통로', () => {
  assert.equal(parseInquiryRecord({ product_id: PID, vendor: ' Verda ', channel: 'mail' }).ok, true)
  assert.equal(parseInquiryRecord({ product_id: 'x', vendor: 'V', channel: 'mail' }).ok, false)
  assert.equal(parseInquiryRecord({ product_id: PID, vendor: '', channel: 'mail' }).ok, false)
  assert.equal(parseInquiryRecord({ product_id: PID, vendor: 'v'.repeat(101), channel: 'mail' }).ok, false)
  assert.equal(parseInquiryRecord({ product_id: PID, vendor: 'V', channel: 'fax' }).ok, false)
  assert.equal(parseInquiryRecord(null).ok, false)
})

test('웹=CLI: 정의 두 줄이 창구 하나와 CLI 이름을 잇고, 창구는 사람 확인 뒤 같은 함수를 부른다', () => {
  const get = GPU_DEFS.find((d) => d.name === 'gpu.inquiry.get')
  const post = GPU_DEFS.find((d) => d.name === 'gpu.inquiry.create')
  assert.equal(get?.op, 'GET /api/pricing/gpu/inquiry')
  assert.equal(get?.cli, 'gpu inquiry get')
  assert.equal(get?.scope, 'read')
  assert.equal(post?.op, 'POST /api/pricing/gpu/inquiry')
  assert.equal(post?.cli, 'gpu inquiry create')
  assert.equal(post?.scope, 'write')
  const route = fs.readFileSync(path.join(import.meta.dirname, '../../app/api/pricing/gpu/inquiry/route.ts'), 'utf8')
  assert.equal(route.match(/await requireMemberApi\(\)/g)?.length, 2)
  assert.match(route, /getInquiry\(await createClient\(\), productId\)/)
  assert.match(route, /recordInquiry\(await createClient\(\), createAdminClient\(\)/)
})
