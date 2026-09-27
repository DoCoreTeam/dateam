/**
 * 알림을 받을 수 있게 됐나 — **받는 쪽이 없으면 보내는 쪽은 뜻이 없다**
 *
 * 실측 2026-09-27: 서비스 워커가 이미 돌고 있었는데 `push` 핸들러가 0건이었다.
 * 서버가 아무리 보내도 화면에는 아무 일도 안 일어나는 상태였다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'
import { PUSH_BLOCK_LABEL, PUSH_BLOCK_REMEDY } from './push-labels.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', '..')
const SW = readFileSync(join(WEB, 'public', 'sw.js'), 'utf8')
const PANEL = readFileSync(join(WEB, TRADING_APP_DIR, 'PushPanel.tsx'), 'utf8')
const ACTIONS = readFileSync(join(WEB, TRADING_APP_DIR, 'actions.ts'), 'utf8')
const MANIFEST = readFileSync(join(WEB, 'app', 'manifest.ts'), 'utf8')

test('★ 서비스 워커가 알림을 받고 누르면 화면으로 간다', () => {
  assert.ok(SW.includes("addEventListener('push'"), 'push 를 안 받는다 — 보내도 아무 일이 없다')
  assert.ok(SW.includes('showNotification('), '받고도 안 띄운다')
  assert.ok(SW.includes("addEventListener('notificationclick'"), '눌러도 아무 데도 안 간다')
  assert.ok(SW.includes('/trading'), '눌렀을 때 갈 곳이 없다')
})

test('★ 본문을 못 읽어도 알림은 띄운다 — 못 받은 것과 안 보낸 것이 같아진다', () => {
  const fn = SW.slice(SW.indexOf("addEventListener('push'"))
  const body = fn.slice(0, fn.indexOf('\n})'))
  assert.ok(body.includes('try {') && body.includes('catch'), '본문 파싱이 감싸져 있지 않다')
  assert.ok(body.includes("payload.title || '알림'"), '제목이 없으면 안 띄운다')
  // catch 안에서 돌아가 버리면 그 알림은 사라진다
  assert.equal(/catch[\s\S]{0,80}return/.test(body), false, '본문을 못 읽으면 알림을 버린다')
})

/**
 * **아이폰은 manifest 가 없으면 푸시가 아예 안 온다.**
 * 홈 화면에 추가된 웹앱에만 알림 권한을 주고, 추가는 manifest 와 독립 실행 표시가 있어야 된다.
 */
test('★ 홈 화면에 추가될 수 있다 — 아이폰 알림의 전제다', () => {
  assert.ok(MANIFEST.includes("display: 'standalone'"), '독립 실행이 아니라 홈 화면 추가가 안 된다')
  assert.ok(MANIFEST.includes('icons:'), '아이콘이 없다')
  // 상호를 박지 않는다. 탭 제목과 같은 자리에서 온다
  assert.ok(MANIFEST.includes('getBranding()'), '상호를 하드코딩했다 — 바꾼 날 홈 화면에만 옛 이름이 남는다')
})

test('★ 구독 창구가 소유자 관문을 지난다', () => {
  for (const fnName of ['getPushKey', 'createPushKey', 'registerPushDevice', 'unregisterPushDevice']) {
    const at = ACTIONS.indexOf(`export async function ${fnName}`)
    assert.ok(at > 0, `${fnName} 가 없다`)
    const body = ACTIONS.slice(at, ACTIONS.indexOf('\n}\n', at))
    assert.ok(body.includes('tradingAccess()'), `${fnName} 가 소유자 확인을 안 한다`)
    assert.ok(body.indexOf('tradingAccess()') < body.indexOf('\n', body.indexOf('tradingAccess()')),
      `${fnName} 가 확인보다 먼저 일한다`)
  }
  assert.ok(ACTIONS.startsWith("'use server'"), '새 창구를 열었다 — 서버 액션이어야 한다')
})

/**
 * **공개 열쇠만 화면으로 내려간다** (S3).
 *
 * 창구가 돌려주는 형에 비밀키 자리가 있으면 언젠가 채워진다.
 */
test('★ 비밀키가 화면으로 가는 길이 없다 (S3)', () => {
  const at = ACTIONS.indexOf('export interface PushKeyView')
  const iface = ACTIONS.slice(at, ACTIONS.indexOf('}', at))
  assert.equal(/private/i.test(iface), false, '창구 형에 비밀키 자리가 있다')

  const fn = ACTIONS.slice(ACTIONS.indexOf('export async function getPushKey'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.equal(/loadVapidKeys|privateKey/.test(body), false, '창구가 비밀키를 읽는다')

  assert.equal(/privateKey|private_key/.test(PANEL), false, '화면이 비밀키를 안다')
})

test('★ 열쇠는 화면을 여는 것만으로 안 생긴다 — 언제 생겼는지 알 수 있어야 한다', () => {
  const fn = ACTIONS.slice(ACTIONS.indexOf('export async function getPushKey'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.equal(body.includes('ensureVapidKeys'), false, '읽기만 해야 하는 창구가 열쇠를 만든다')
})

test('★ 못 켜는 이유마다 무엇을 하면 되는지 말한다', () => {
  for (const reason of ['unsupported', 'permission_denied', 'no_key', 'insecure_context', 'subscribe_failed'] as const) {
    assert.ok(PUSH_BLOCK_LABEL[reason], `${reason} 사유가 없다`)
    assert.ok(PUSH_BLOCK_REMEDY[reason], `${reason} 에 할 일이 없다`)
  }
  // 흐린 단추로 말하지 않는다 — 왜 못 누르는지가 화면에 있어야 한다
  assert.ok(PANEL.includes('PUSH_BLOCK_LABEL[blocked]'), '막힌 이유를 화면이 안 말한다')
  assert.ok(PANEL.includes("from '@/lib/trading/notify/push-labels'"), '말을 화면 안에서 짓는다')
})

test('★ 첫 렌더가 서버와 같은 모양이다 — 구독 여부는 효과 안에서 본다', () => {
  const at = PANEL.indexOf('useState<string | null>(null)')
  assert.ok(at > 0, '구독 상태의 첫 값이 null 이 아니다 — 하이드레이션이 어긋난다')
  assert.ok(PANEL.includes('useEffect('), '렌더 중에 브라우저 상태를 본다')
})
