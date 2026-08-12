import test from 'node:test'
import assert from 'node:assert/strict'
import { isRouteNavigationClick } from './nav-anchor.ts'

const base = { href: '/daily', hasDownload: false, pathname: '/meeting-notes/abc' }

test('내부 경로 클릭은 이동이다', () => {
  assert.equal(isRouteNavigationClick(base), true)
  assert.equal(isRouteNavigationClick({ ...base, href: '/daily?tab=all' }), true)
})

test('핵심 사고: blob 다운로드 앵커는 이동이 아니다 — 옛 가드가 blob:http를 통과시켰다', () => {
  assert.equal(
    isRouteNavigationClick({ ...base, href: 'blob:http://localhost:3000/9f2c-...', hasDownload: true }),
    false,
  )
  // download 속성이 없어도 blob은 이동이 아니다(이중 방어)
  assert.equal(isRouteNavigationClick({ ...base, href: 'blob:http://localhost:3000/9f2c' }), false)
})

test('download 속성이 붙은 내부 경로도 이동이 아니다 (파일 저장)', () => {
  assert.equal(isRouteNavigationClick({ ...base, href: '/api/export.csv', hasDownload: true }), false)
})

test('외부·특수 스킴은 전부 이동 아님', () => {
  for (const href of [
    'https://x.com', 'http://x.com', '//cdn.example.com/a.js',
    'mailto:a@b.c', 'tel:01012345678', 'data:text/plain,hi', '#section',
  ]) {
    assert.equal(isRouteNavigationClick({ ...base, href }), false, href)
  }
})

test('새 탭으로 열리는 클릭은 이 탭을 안 바꾼다 — 로더를 켜면 잠긴다', () => {
  assert.equal(isRouteNavigationClick({ ...base, opensElsewhere: true }), false)
})

test('이미 막힌 클릭은 이동이 아니다', () => {
  assert.equal(isRouteNavigationClick({ ...base, defaultPrevented: true }), false)
})

test('같은 경로(쿼리·해시만 다름)는 이동으로 보지 않는다', () => {
  assert.equal(isRouteNavigationClick({ ...base, href: '/meeting-notes/abc' }), false)
  assert.equal(isRouteNavigationClick({ ...base, href: '/meeting-notes/abc?edit=1' }), false)
  assert.equal(isRouteNavigationClick({ ...base, href: '/meeting-notes/abc#top' }), false)
})

test('href 없으면 이동 아님', () => {
  assert.equal(isRouteNavigationClick({ ...base, href: null }), false)
})
