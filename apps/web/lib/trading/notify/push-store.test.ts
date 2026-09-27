/**
 * 알림 받을 기기와 발송 열쇠 — **비밀이 새는 길이 없는가**
 *
 * 이 모듈은 저장소에 처음 들어오는 **비밀키를 다루는 자리**다. 그래서 값이 맞는지보다
 * 값이 어디로 갈 수 있는지를 먼저 센다(LOOP.md 7절 S3).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toBase64Url, fromBase64Url, keyFingerprint, rawPublicKeyFromSpki } from './push-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations')
const SQL = readFileSync(join(MIGRATIONS, '290_trading_push.sql'), 'utf8')
const SRC = readFileSync(join(HERE, 'push-store.ts'), 'utf8')

test('base64url 은 왕복한다 — 푸시 규격은 +/= 를 안 받는다', () => {
  const raw = Buffer.from([0, 1, 250, 251, 252, 253, 254, 255, 64, 63, 62])
  const encoded = toBase64Url(raw)
  assert.equal(/[+/=]/.test(encoded), false, '푸시 서버가 못 읽는 글자가 섞였다')
  assert.deepEqual(fromBase64Url(encoded), raw)
})

test('공개키는 압축 안 한 점만 받는다 — 아니면 브라우저가 조용히 못 쓴다', () => {
  const ok = Buffer.concat([Buffer.alloc(26), Buffer.from([0x04]), Buffer.alloc(64)])
  assert.equal(rawPublicKeyFromSpki(ok).length, 65)
  const bad = Buffer.concat([Buffer.alloc(26), Buffer.from([0x02]), Buffer.alloc(64)])
  assert.throws(() => rawPublicKeyFromSpki(bad))
  assert.throws(() => rawPublicKeyFromSpki(Buffer.alloc(10)))
})

test('지문은 같은 공개키에 같은 값이고 다른 키에 다른 값이다', () => {
  assert.equal(keyFingerprint('BAAA'), keyFingerprint('BAAA'))
  assert.notEqual(keyFingerprint('BAAA'), keyFingerprint('BAAB'))
  assert.equal(keyFingerprint('BAAA').length, 12)
})

/* ── 보안 ──────────────────────────────────────────────── */

test('★ 표 둘 다 RLS 가 켜지고 익명·로그인 사용자에게 권한이 없다 (S1)', () => {
  for (const table of ['trading_push_subscriptions', 'trading_push_keys']) {
    assert.ok(SQL.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), `${table} RLS 가 꺼져 있다`)
    assert.ok(SQL.includes(`ALTER TABLE public.${table} FORCE  ROW LEVEL SECURITY;`), `${table} FORCE 가 없다`)
    assert.ok(SQL.includes(`REVOKE ALL ON public.${table} FROM anon;`), `${table} 익명 권한을 안 걷었다`)
    assert.ok(SQL.includes(`REVOKE ALL ON public.${table} FROM authenticated;`), `${table} 로그인 권한을 안 걷었다`)
  }
  // 정책을 새로 만들지 않았다. 만들었다면 TO public 이 아니어야 한다
  assert.equal(/TO public/i.test(SQL), false, '정책 대상이 public 이다')
})

test('★ 같은 기기가 두 줄이 안 된다 (M9)', () => {
  assert.ok(SQL.includes('UNIQUE (endpoint)'), '기기 주소가 유일 키가 아니다 — 알림이 두 번 간다')
})

/**
 * **평문 비밀키 칼럼이 없다.**
 *
 * 칼럼 이름에 `_enc` 가 붙어 있고 봉투 함수를 지나는지를 본다. 이름만 보면
 * `private_key` 가 평문으로 들어와도 통과하므로 저장하는 줄까지 본다.
 */
test('★ 비밀키가 평문으로 저장되는 길이 없다 (S3)', () => {
  assert.ok(SQL.includes('private_key_enc JSONB'), '봉투 칼럼이 없다')
  assert.equal(/\bprivate_key\s+TEXT/.test(SQL), false, '평문 비밀키 칼럼이 있다')
  assert.ok(SRC.includes('private_key_enc: sealTradingSecret('), '비밀키를 봉투에 안 넣고 저장한다')
  assert.equal(/private_key_enc:\s*privateKeyPem/.test(SRC), false, '비밀키를 그대로 넣는다')
})

/**
 * **화면이 보는 형에 비밀키 자리가 없다.**
 *
 * 자리가 있으면 언젠가 채워진다. 있는지 없는지와 공개키만 나간다.
 */
test('★ 화면 쪽 형에 비밀키 자리가 없다 (S3)', () => {
  const iface = SRC.slice(SRC.indexOf('export interface PushKeyStatus'))
  const body = iface.slice(0, iface.indexOf('}'))
  assert.equal(/private/i.test(body), false, '화면 형에 비밀키 자리가 있다')
  assert.ok(body.includes('publicKey'), '공개키를 안 준다')

  const fn = SRC.slice(SRC.indexOf('export async function pushKeyStatus'))
  const fnBody = fn.slice(0, fn.indexOf('\n}'))
  assert.equal(/private_key_enc|openTradingSecret/.test(fnBody), false,
    '화면이 묻는 함수가 비밀키를 연다')
})

test('★ 열쇠는 있으면 안 바꾼다 — 갈면 등록된 기기가 조용히 안 받는다', () => {
  const fn = SRC.slice(SRC.indexOf('export async function ensureVapidKeys'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes('if (existing.configured'), '이미 있는지 안 보고 만든다')
  assert.ok(body.indexOf('existing.configured') < body.indexOf('generateKeyPairSync'),
    '만들고 나서 있는지 본다 — 그 사이에 이미 갈린다')
})

test('★ 기기 주소는 https 만 받는다 (S4)', () => {
  const fn = SRC.slice(SRC.indexOf('export async function saveSubscription'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes("parsed.protocol !== 'https:'"), '평문 주소로도 등록된다')
  assert.ok(body.indexOf('new URL(endpoint)') < body.indexOf('.upsert('), '검사 전에 저장한다')
})

test('★ 구독 목록을 못 읽으면 빈 배열이 아니라 오류다', () => {
  const fn = SRC.slice(SRC.indexOf('export async function listSubscriptions'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes('if (error) throw'),
    '못 읽은 것을 「보낼 기기가 없다」로 돌려준다 — 조용한 실패다')
})

test('★ server-only 라 화면이 못 들여온다', () => {
  assert.ok(SRC.startsWith("import 'server-only'"), '비밀키를 다루는 모듈이 클라이언트로 갈 수 있다')
})
