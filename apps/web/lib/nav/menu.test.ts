import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_LABEL, navLabel, SERVICE_NAV, EXIT_TO_MAIN } from './menu.ts'
import { SERVICE_LABEL } from '../terms/index.ts'

test('서비스로 들어가는 링크는 간판과 같은 말을 쓴다', () => {
  assert.equal(NAV_LABEL['/crm'], SERVICE_LABEL.crm)
  assert.equal(NAV_LABEL['/ci'], SERVICE_LABEL.ci)
  assert.equal(NAV_LABEL['/develop'], SERVICE_LABEL.develop)
})

test('★ /lead-intake 는 이름이 하나다 — 사이드바 「프로젝트관리」와 전체메뉴 「리드 인테이크」로 갈렸던 자리', () => {
  assert.equal(NAV_LABEL['/lead-intake'], '리드 인테이크')
})

test('「서비스」 그룹에는 사이드바가 통째로 바뀌는 곳만 온다', () => {
  assert.deepEqual(SERVICE_NAV.map((s) => s.href), ['/crm', '/ci'])
  // 관리자·개발자센터는 권한/외부라 여기 오지 않는다
  assert.ok(!SERVICE_NAV.some((s) => s.href === '/admin' || s.href === '/develop'))
})

test('나가는 문은 하나이고 문구도 하나다', () => {
  assert.equal(EXIT_TO_MAIN.href, '/home')
  assert.equal(EXIT_TO_MAIN.label, '업무로 나가기')
})

test('등재를 잊으면 드러난다 — 조용히 빈칸을 그리지 않는다', () => {
  assert.equal(navLabel('/home'), '홈')
  assert.equal(navLabel('/없는경로'), '/없는경로')
})
