/**
 * 「키가 없다」고 말하는 자리는 넣는 곳으로 보낸다
 *
 * 없다고만 말하면 읽는 쪽이 그 설정을 직접 찾아야 한다. 그것은 우리가 대신할 수 있는 일이다.
 *
 * 실측 2026-09-30: 키가 없다고 말하는 화면이 넷인데 길이 있는 곳은 둘(공급자 카드·수집처 카드)이고
 * 없는 곳이 둘(포털 연동 카드·레이더 훑기 안내)이었다. 하나만 고치면 같은 지적이 다시 온다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HOST_AI_SETTINGS_HREF } from '../ai/host-providers.ts'
import { RFP_RADAR, RFP_ADMIN } from '../terms.ts'

/** 키가 없다고 말하는 화면 전부. 새 화면이 생기면 여기 늘린다 */
const SURFACES = [
  { name: '포털 연동 카드', path: '../../../app/(rfp)/rfp/admin/G2bServices.tsx' },
  { name: '레이더 훑기 안내', path: '../../../components/rfp/RadarRules.tsx' },
  { name: '수집처 카드', path: '../../../components/rfp/SourceSites.tsx' },
  { name: '공급자 카드', path: '../../../components/rfp/VendorSettings.tsx' },
] as const

/**
 * 주석과 **import 줄**을 지운다.
 *
 * import 만 남아도 이름은 파일에 있다. 처음 쓴 가드가 그래서 통과했다 —
 * 단추를 통째로 지웠는데 초록이었다. 이름이 아니라 **값이 가는 자리**를 봐야 한다.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
}

for (const s of SURFACES) {
  test(`${s.name} 가 넣는 곳으로 보낸다`, () => {
    const src = read(s.path)
    // 이름이 있는 것으로는 모자란다. 그 값이 href 로 **가는지**를 본다
    assert.match(src, /href=\{HOST_AI_SETTINGS_HREF\}/, `${s.name} 에 넣으러 가는 길이 없다`)
    // 눌러서 갈 수 있어야 한다 — 글자만 있으면 길이 아니다
    assert.match(src, /serviceKeyLink|vendorsLink/, `${s.name} 에 길 문구가 없다`)
    assert.doesNotMatch(src, /href=["']\/admin\/settings["']/, `${s.name} 가 주소를 손으로 적었다`)
  })
}

test('넷이 같은 주소 상수를 쓴다', () => {
  // 한 곳만 다른 주소를 쓰면 그 화면만 엉뚱한 데로 보낸다
  assert.equal(HOST_AI_SETTINGS_HREF, '/admin/settings')
  for (const s of SURFACES) {
    const hrefs = read(s.path).match(/href=\{([^}]+)\}/g) ?? []
    const settings = hrefs.filter((h) => h.includes('SETTINGS'))
    assert.ok(settings.every((h) => h.includes('HOST_AI_SETTINGS_HREF')), `${s.name} 가 다른 상수를 쓴다`)
  }
})

test('안내 문구와 길 문구가 둘 다 있다', () => {
  // 길만 있고 이유가 없으면 왜 가야 하는지 모르고, 이유만 있고 길이 없으면 갈 데를 모른다
  assert.ok(RFP_ADMIN.g2bNoKey, '포털 연동 카드의 사유 문구가 없다')
  assert.ok(RFP_RADAR.noServiceKey, '레이더 훑기의 사유 문구가 없다')
  assert.ok(RFP_RADAR.serviceKeyLink, '넣으러 가는 길의 문구가 없다')
})

test('키 값 자체는 화면으로 안 나간다', () => {
  // 있는지 없는지만 넘긴다. 값을 넘기면 그 길이 곧 유출 경로가 된다
  const card = read('../../../app/(rfp)/rfp/admin/G2bServices.tsx')
  assert.match(card, /hasServiceKey/, '키가 있는지 여부를 안 받는다')
  assert.doesNotMatch(card, /serviceKey\s*[:=]\s*(?!hasServiceKey)[a-zA-Z_$]/, '키 값을 받는 자리가 있다')
  assert.doesNotMatch(card, /process\.env/, '화면이 환경변수를 읽는다')
})
