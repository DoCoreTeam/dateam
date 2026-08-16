/**
 * 구글 연결 계약 가드 (dacrm T1-09 재개판)
 *
 * 이 가드가 지키는 것은 **"클라이언트를 하나만 쓴다"**이다.
 * CRM 이 자기 OAuth 클라이언트를 따로 만들면 사용자는 같은 회사 앱에 두 번 동의해야 하고,
 * 관리자는 콘솔에서 redirect URI 를 두 벌 관리해야 한다.
 *
 * 그리고 **필요한 권한만 받는다.** 안 쓰는 권한은 사고 표면이고,
 * 동의 화면에서 사용자를 겁먹게 한다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const START = readFileSync(join(ROOT, 'app/api/auth/google-drive/route.ts'), 'utf8')
const CALLBACK = readFileSync(join(ROOT, 'app/api/auth/google-drive/callback/route.ts'), 'utf8')
const CARD = readFileSync(join(ROOT, 'app/(crm)/crm/settings/IntegrationCard.tsx'), 'utf8')
const CONNECT = readFileSync(join(ROOT, 'lib/crm/integrations/connect.ts'), 'utf8')

/**
 * 주석을 걷어낸 코드만 본다.
 *
 * 처음엔 원문을 그대로 훑었더니 **"왜 이렇게 했는지 설명한 주석"이 위반으로 잡혔다.**
 * 가드가 설명을 벌하면 다음 사람은 설명을 지운다 — 그게 더 나쁘다.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
}

test('★ CRM 은 호스트의 구글 클라이언트를 그대로 쓴다 — 두 벌을 만들지 않는다', () => {
  // 클라이언트 자격을 읽는 곳은 lib/google-drive.ts 한 곳뿐이어야 한다
  assert.ok(!/process\.env\.GOOGLE_CLIENT/.test(codeOnly(CONNECT)),
    'CRM 이 클라이언트 자격을 직접 읽는다 — 호스트 것을 재사용해야 한다')
  assert.match(CONNECT, /getOAuth2Client/, '호스트의 클라이언트 팩토리를 안 쓴다')
})

test('★ 콜백 경로를 새로 만들지 않는다 — 구글 콘솔에 등록된 redirect URI 는 하나다', () => {
  // 시작 라우트가 목적을 쿠키로 넘기고 같은 콜백에서 갈라 쓴다
  assert.match(START, /PURPOSE_COOKIE/, '목적을 쿠키로 넘기지 않는다')
  assert.match(CALLBACK, /PURPOSE_COOKIE/, '콜백이 목적을 읽지 않는다')
  assert.match(CARD, /purpose=crm/, '카드가 목적을 지정하지 않는다')
})

test('★ 목적별로 필요한 권한만 받는다', () => {
  const scopes = START.slice(START.indexOf('const SCOPES'), START.indexOf('}', START.indexOf('crm: [')) + 1)

  // Drive 는 메일을 볼 이유가 없다
  const drive = scopes.slice(scopes.indexOf('drive:'), scopes.indexOf('crm:'))
  assert.ok(!drive.includes('gmail'), 'Drive 동의에 gmail 이 섞였다')

  // CRM 은 읽기만 — 보내기 권한은 지금 쓸 데가 없다
  assert.match(scopes, /gmail\.readonly/, 'CRM 이 gmail 을 못 읽는다')
  assert.match(scopes, /calendar\.readonly/, 'CRM 이 일정을 못 읽는다')
  assert.ok(!/gmail\.send|gmail\.modify|calendar\.events\b/.test(scopes),
    '쓰기 권한을 받고 있다 — 안 쓰는 권한은 사고 표면이다')
})

test('★ CRM 연결은 멤버면 되고, Drive 연결은 관리자만 — 팀원 메일이 영영 안 들어오면 안 된다', () => {
  assert.match(START, /resolveCrmAccess/, 'CRM 목적일 때 멤버십을 안 본다')
  assert.match(START, /관리자만 Google Drive/, 'Drive 의 관리자 제한이 사라졌다')
  assert.match(CALLBACK, /resolveCrmAccess/, '콜백이 권한을 다시 안 본다')
})

test('토큰을 평문으로 저장하지 않는다 — 새면 그 사람 메일함 전체가 샌다', () => {
  assert.match(CONNECT, /encryptSecret\(tokens\.accessToken\)/)
  assert.match(CONNECT, /encryptSecret\(tokens\.refreshToken\)/)
  assert.ok(!/accessTokenEnc:\s*tokens\.accessToken/.test(CONNECT), '액세스 토큰이 평문으로 들어간다')
})

test('토큰은 감사 로그에도 남기지 않는다', () => {
  const code = codeOnly(CONNECT)
  // import 줄이 아니라 실제 호출부를 본다 — 첫 매치를 그냥 쓰면 import 를 검사하게 된다
  const call = code.indexOf('await writeAudit(')
  assert.ok(call > 0, 'writeAudit 호출이 없다')
  const audit = code.slice(call, code.indexOf('})', call))
  assert.ok(!/accessToken|refreshToken|TokenEnc/.test(audit), '감사 로그가 유출 경로가 된다')
})

test('★ 연결 결과를 화면이 말한다 — 붙여만 놓고 안 보여 주면 실패가 조용히 묻힌다', () => {
  assert.match(CARD, /google.*connected|connected.*google/s, '성공을 안 알린다')
  assert.match(CARD, /구글 연결에 실패/, '실패를 안 알린다')
  assert.match(CALLBACK, /google:\s*'connected'/, '콜백이 결과를 안 붙인다')
})

test('만료된 토큰은 갱신해서 쓴다 — 잡마다 "만료라서 못 했다"면 연동이 없는 것과 같다', () => {
  assert.match(CONNECT, /refreshAccessToken/, '갱신 경로가 없다')
  assert.match(CONNECT, /status: 'error'/, '갱신 실패를 상태로 안 남긴다')
})
