import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseManifest, isSafeReleasePath, SIGNED_URL_TTL_SECONDS } from './manifest.ts'

const SHA = 'a'.repeat(64)
const good = () => ({
  version: '0.2.0',
  publishedAt: '2026-10-24T12:00:00.000Z',
  files: [
    { target: 'windows-x64', path: 'v0.2.0/teamda-windows-x64.zip', fileName: 'teamda-windows-x64.zip', size: 41_000_000, sha256: SHA },
    { target: 'linux-x64', path: 'v0.2.0/teamda-linux-x64.tar.gz', fileName: 'teamda-linux-x64.tar.gz', size: 40_000_000, sha256: SHA },
  ],
})

test('정상 목록은 통과하고 값이 그대로 나온다', () => {
  const r = parseManifest(good())
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.manifest.version, '0.2.0')
  assert.equal(r.manifest.files.length, 2)
  assert.equal(r.manifest.files[0].path, 'v0.2.0/teamda-windows-x64.zip')
})

test('서명 주소 수명은 600초', () => {
  assert.equal(SIGNED_URL_TTL_SECONDS, 600)
})

test('경로 탈출과 절대 경로와 다른 판 폴더를 거절한다', () => {
  for (const p of ['../latest.json', 'v0.2.0/../../etc/passwd', '/v0.2.0/teamda-windows-x64.zip', 'v0.1.0/teamda-windows-x64.zip', 'v0.2.0\\teamda-windows-x64.zip']) {
    assert.equal(isSafeReleasePath(p, '0.2.0', 'teamda-windows-x64.zip'), false, p)
    const m = good()
    m.files[0] = { ...m.files[0], path: p }
    const r = parseManifest(m)
    assert.equal(r.ok, false, p)
  }
  assert.equal(isSafeReleasePath('v0.2.0/teamda-windows-x64.zip', '0.2.0', 'teamda-windows-x64.zip'), true)
})

test('필드가 빠지거나 틀리면 거절한다', () => {
  const cases: Array<[string, (m: ReturnType<typeof good>) => unknown]> = [
    ['version 없음', ({ version: _v, ...rest }) => rest],
    ['publishedAt 없음', ({ publishedAt: _p, ...rest }) => rest],
    ['files 빔', (m) => ({ ...m, files: [] })],
    ['sha256 없음', (m) => ({ ...m, files: [{ ...m.files[0], sha256: undefined }] })],
    ['size 0', (m) => ({ ...m, files: [{ ...m.files[0], size: 0 }] })],
    ['모르는 대상', (m) => ({ ...m, files: [{ ...m.files[0], target: 'plan9-x64' }] })],
    ['대상 겹침', (m) => ({ ...m, files: [m.files[0], m.files[0]] })],
    ['파일 이름 형식', (m) => ({ ...m, files: [{ ...m.files[0], fileName: 'evil.exe', path: 'v0.2.0/evil.exe' }] })],
  ]
  for (const [label, mk] of cases) {
    const r = parseManifest(mk(good()))
    assert.equal(r.ok, false, label)
    if (!r.ok) assert.ok(r.reason.length > 0, label)
  }
  assert.equal(parseManifest(null).ok, false)
  assert.equal(parseManifest([]).ok, false)
})
