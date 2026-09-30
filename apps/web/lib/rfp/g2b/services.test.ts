import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  G2B_SERVICES, serviceOf, unusedServices, rejectOf, REJECT_NEXT,
  serviceStatus, stateMap, needsApplyCount, toServiceState, SERVICE_STATE_COLS,
  type G2bService, type G2bServiceState,
} from './services.ts'
import { G2B_BASE } from './client.ts'

test('여섯 서비스가 등록돼 있고 각각 무엇을 주는지 적혀 있다', () => {
  assert.equal(G2B_SERVICES.length, 6)
  for (const s of G2B_SERVICES) {
    assert.ok(s.portalNo.length > 0, `${s.id} 에 포털 번호가 없다`)
    assert.ok(s.base.startsWith('https://apis.data.go.kr/'), `${s.id} 주소가 이상하다`)
    assert.ok(s.gives.length > 0, `${s.id} 가 무엇을 주는지 안 적혀 있다`)
  }
})

test('포털 번호가 겹치지 않는다', () => {
  const nos = G2B_SERVICES.map((s) => s.portalNo)
  assert.equal(new Set(nos).size, nos.length)
})

test('지금 쓰는 것은 입찰공고 하나뿐이고 나머지 다섯은 안 쓴다', () => {
  const used = G2B_SERVICES.filter((s) => s.inUse)
  assert.deepEqual(used.map((s) => s.id), ['bidPublicInfo'])
  assert.equal(unusedServices().length, 5)
})

test('쓰고 있는 서비스의 주소가 클라이언트가 실제로 부르는 주소와 같다', () => {
  assert.equal(serviceOf('bidPublicInfo').base, G2B_BASE, '등록부와 실제가 갈리면 등록부가 종이가 된다')
})

test('없는 서비스를 찾으면 조용히 undefined 로 넘어가지 않는다', () => {
  assert.throws(() => serviceOf('nope' as never), /unregistered portal service/)
})

test('★ 신청 안 됨과 한도 초과와 키 문제를 갈라 읽는다', () => {
  assert.equal(rejectOf('30'), 'not_registered')
  assert.equal(rejectOf('SERVICE_KEY_IS_NOT_REGISTERED_ERROR'), 'not_registered')
  assert.equal(rejectOf('22'), 'quota_exceeded')
  assert.equal(rejectOf('31'), 'bad_key')
  assert.equal(rejectOf('999'), 'unknown', '모르는 코드를 아는 척하지 않는다')
  assert.equal(rejectOf(null), 'unknown')
})

test('★ 거절마다 사용자가 할 일이 다르다', () => {
  assert.equal(REJECT_NEXT.not_registered, 'apply', '기다려도 안 열린다, 우리가 신청해야 한다')
  assert.equal(REJECT_NEXT.quota_exceeded, 'wait')
  assert.equal(REJECT_NEXT.bad_key, 'fix_key')
  assert.equal(REJECT_NEXT.unknown, 'report')
  // 넷이 다 달라야 갈라 둔 값어치가 있다
  assert.equal(new Set(Object.values(REJECT_NEXT)).size, 4)
})

// 신청 상태 — I11

const 서비스 = (over: Partial<G2bService> = {}): G2bService => ({
  id: 'bidPublicInfo', portalNo: '1', base: 'https://x', gives: 'y', inUse: false, ...over,
})

const 상태 = (over: Partial<G2bServiceState> = {}): G2bServiceState => ({
  serviceId: 'bidPublicInfo', applied: false, appliedAt: null, note: null, ...over,
})

test('신청 여부와 구현 여부를 갈라 말한다', () => {
  // 한 배지로 뭉치면 「안 씀」이 신청을 안 해서인지 코드가 아직 안 불러서인지 갈라 볼 수 없고,
  // 그 둘은 사용자가 할 일이 다르다
  assert.equal(serviceStatus(서비스({ inUse: true }), 상태({ applied: true })), 'live')
  assert.equal(serviceStatus(서비스({ inUse: false }), 상태({ applied: true })), 'applied_unused')
  assert.equal(serviceStatus(서비스({ inUse: true }), 상태({ applied: false })), 'needs_apply')
  assert.equal(serviceStatus(서비스({ inUse: false }), 상태({ applied: false })), 'needs_apply')
})

test('안 적어 둔 것을 안 했다고 단정하지 않는다', () => {
  // 신청은 포털에서 사람이 하는 일이라 우리가 알 수 없다. 모르는 것을 아는 것처럼 말하지 않는다
  assert.equal(serviceStatus(서비스({ inUse: false }), undefined), 'unknown')
  // 다만 이미 쓰고 있으면 신청된 것이 확실하다 — 안 됐으면 포털이 거절했을 것이다
  assert.equal(serviceStatus(서비스({ inUse: true }), undefined), 'live')
})

test('신청해야 열리는 것을 센다', () => {
  const services = [서비스({ id: 'bidPublicInfo' }), 서비스({ id: 'scsbid' }), 서비스({ id: 'nuri' })]
  const map = stateMap([
    상태({ serviceId: 'bidPublicInfo', applied: true }),
    상태({ serviceId: 'scsbid', applied: false }),
  ])
  // nuri 는 적어 둔 것이 없어 unknown 이라 「할 일」에 안 센다 — 모르는 것을 할 일로 만들지 않는다
  assert.equal(needsApplyCount(services, map), 1)
})

test('DB 행을 상태로 옮긴다', () => {
  const s = toServiceState({
    service_id: 'scsbid', applied: true, applied_at: '2026-09-30T00:00:00Z', note: '신청번호 123',
  })
  assert.deepEqual(s, {
    serviceId: 'scsbid', applied: true, appliedAt: '2026-09-30T00:00:00Z', note: '신청번호 123',
  })
  // applied 가 없으면 false 다 — 없는 것을 참으로 읽으면 할 일이 사라진다
  assert.equal(toServiceState({ service_id: 'nuri' }).applied, false)
})

test('읽는 칸 목록이 표에 실재하는 이름만 쓴다', () => {
  const REAL = new Set(['org_id', 'service_id', 'applied', 'applied_at', 'note', 'updated_at'])
  const unknown = SERVICE_STATE_COLS.split(',').map((c) => c.trim()).filter((c) => !REAL.has(c))
  assert.deepEqual(unknown, [], `표에 없는 칸을 읽으려 한다: ${unknown.join(', ')}`)
})

test('299 가 표를 만들면서 같은 판에서 RLS 를 켠다', () => {
  const sql = readFileSync(
    new URL('../../../../../supabase/migrations/299_rfp_g2b_service_state.sql', import.meta.url), 'utf8',
  ).replace(/^\s*--.*$/gm, '')

  assert.match(sql, /create table if not exists public\.rfp_g2b_service_states/i)
  assert.match(sql, /enable row level security/i, '표를 만들고 RLS 를 안 켠다')
  // 서비스 id 는 여섯으로 고정된 이름이라 기본키가 하나면 조직 하나만 가질 수 있다
  assert.match(sql, /primary key \(org_id, service_id\)/i, '기본키에 조직이 없다')
  // 대상에 public 을 쓰면 로그인 안 한 사람까지 들어온다
  assert.doesNotMatch(sql, /for select to public|for all to public/i, '정책 대상이 public 이다')
  assert.match(sql, /for select to authenticated/i)
  assert.match(sql, /rfp_is_admin\(org_id\)/, '쓰기를 관리자로 안 막는다')
  // GRANT 와 RLS 는 다른 벽이다
  assert.match(sql, /revoke all on public\.rfp_g2b_service_states from anon/i, '익명 권한을 안 거둔다')
  // 사본은 원본의 RLS 를 안 물려받는다
  assert.doesNotMatch(sql, /create table[\s\S]*?\bas\s+select/i, '사본을 뜬다')
})

test('창구가 권한 판정을 표에 맡기고 서비스롤을 안 쓴다', () => {
  const src = readFileSync(
    new URL('../../../app/api/rfp/g2b-services/route.ts', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  assert.match(src, /requireMemberApi\s*\(/, '로그인 확인이 없다')
  // 서비스롤을 쓰면 표 정책을 통째로 지나가고, 그러면 관리자만 고친다는 말이 거짓이 된다
  assert.doesNotMatch(src, /createAdminClient/, '창구가 서비스롤을 쓴다')
  // 조직을 요청이 보내게 두면 남의 조직 상태를 바꿀 수 있다
  assert.match(src, /rfp_default_org/, '조직을 서버가 안 정한다')
  assert.doesNotMatch(src, /body\.orgId|body\.org_id/, '요청에서 조직을 받는다')
  // 모르는 서비스 id 를 받으면 표에 쓰레기 줄이 생기고 화면이 그것을 서비스로 그린다
  assert.match(src, /KNOWN\.has\(/, '모르는 서비스 id 를 안 거른다')
})
