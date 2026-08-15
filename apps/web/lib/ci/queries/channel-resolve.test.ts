import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..', '..')

// 이 파일은 DB 클라이언트를 쓰는 경로라 순수 단위 테스트가 안 된다.
// 대신 **판정이 한 곳에만 있는지**를 정적으로 잠근다 —
// 실제 사고는 로직이 틀려서가 아니라 **두 곳에 흩어져 한쪽만 고쳐서** 났다.

test('★ 채널 동일성 판정은 한 곳(SSOT)에서만 한다 — 두 곳에 두면 한쪽만 고치게 된다', () => {
  const callers = [
    'lib/ci/queries/channels.ts',      // 사용자가 채널 주소를 직접 넣는 길
    'lib/ci/jobs/handlers.ts',         // 콘텐츠를 수집하다 채널을 알게 되는 길
  ]
  for (const f of callers) {
    const src = readFileSync(join(web, f), 'utf8')
    assert.match(src, /resolveExistingChannel\(/, `${f}가 채널 해소 SSOT를 쓰지 않는다`)
  }
})

test('★ 호출부가 채널 조회를 자작하지 않는다 — 자작하면 승격 갈래를 빠뜨린다', () => {
  const callers = ['lib/ci/queries/channels.ts', 'lib/ci/jobs/handlers.ts']
  for (const f of callers) {
    const src = readFileSync(join(web, f), 'utf8')
    // ci_channels에서 external_id로 직접 찾는 조회가 남아 있으면 그게 우회로다
    const selfLookup = /from\('ci_channels'\)[\s\S]{0,300}?\.eq\('external_id'/.test(src)
    assert.equal(selfLookup, false, `${f}가 external_id로 채널을 직접 찾는다 — SSOT를 우회한다`)
  }
})

test('SSOT는 세 갈래를 모두 갖는다 — 하나라도 빠지면 채널이 갈라진다', () => {
  const src = readFileSync(join(here, 'channel-resolve.ts'), 'utf8')
  // ① 정확 일치
  assert.match(src, /\.eq\('external_id', key\.externalId\)/, '키 정확 일치 갈래가 없다')
  // ② 진짜 ID → 옛 임시키 행 승격
  assert.match(src, /provisionalKeyCandidates\(/, '임시키 승격 갈래가 없다')
  assert.match(src, /external_id: key\.externalId/, '승격 시 진짜 ID로 올리지 않는다')
  // ③ 임시키 → 이미 승격된 행을 핸들로 찾기 (이 갈래가 없어서 사고가 났다)
  assert.match(src, /\.eq\('handle', ref\.handle\)/, '승격된 행을 핸들로 찾는 갈래가 없다 — 재입력마다 새 행이 생긴다')
})

test('승격은 행을 새로 만들지 않고 기존 행을 올린다 — 만들면 그 순간 채널이 둘이 된다', () => {
  const src = readFileSync(join(here, 'channel-resolve.ts'), 'utf8')
  assert.doesNotMatch(src, /\.insert\(/, 'SSOT가 행을 만든다 — 생성은 호출부 책임이다')
  assert.match(src, /\.update\(\{\s*external_id: key\.externalId\s*\}\)/, '기존 행을 승격하지 않는다')
})

test('삭제된 채널을 되살려 붙이지 않는다', () => {
  const src = readFileSync(join(here, 'channel-resolve.ts'), 'utf8')
  assert.match(src, /\.is\('deleted_at', null\)/)
})

test('★ 링크 투입 확인은 새로고침보다 먼저 뜬다 — 접수됐는데 "보내는 중…"이 멈춰 보이면 안 된다', () => {
  const src = readFileSync(join(web, 'components/ci/LinkIntakeBox.tsx'), 'utf8')
  const busyOff = src.indexOf('setBusy(false)\n')
  const refresh = src.indexOf('onDone?.(res.data)')
  assert.ok(busyOff > 0 && refresh > busyOff, '새로고침을 먼저 걸면 화면 커밋이 그때까지 붙잡힌다')
  assert.match(src, /setTimeout\(\(\) => onDone\?\.\(res\.data\), 0\)/,
    '같은 tick에 refresh를 부르면 transition이 상태 커밋을 지연시킨다')
})
