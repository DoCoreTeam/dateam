import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { KOREAEXIM_INTERMEDIATE_CA, KOREAEXIM_BASE, KOREAEXIM_TIMEOUT_MS } from './koreaexim.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const MOD = 'lib/gpu/koreaexim.ts'

describe('환율 API — 서버가 빠뜨린 것을 우리가 채운다', () => {
  it('★ 중간 인증서를 들고 있다 — 서버가 리프만 보내서 Node 가 경로를 못 잇는다', () => {
    assert.match(KOREAEXIM_INTERMEDIATE_CA, /^-----BEGIN CERTIFICATE-----/)
    assert.match(KOREAEXIM_INTERMEDIATE_CA, /-----END CERTIFICATE-----$/)
    assert.ok(KOREAEXIM_INTERMEDIATE_CA.length > 800, '인증서 본문이 잘렸다')
  })

  it('★ 검증을 끄지 않는다 — 기본 루트에 «더하기»만 한다', () => {
    const src = read(MOD)
    assert.match(src, /\[\s*\.\.\.tls\.rootCertificates,\s*KOREAEXIM_INTERMEDIATE_CA\s*\]/,
      '기본 루트 목록을 유지한 채 중간 인증서만 더해야 한다')
    assert.doesNotMatch(src, /rejectUnauthorized\s*:\s*false/,
      '검증을 끄면 그건 고친 게 아니라 구멍을 뚫은 것이다')
    assert.doesNotMatch(src, /NODE_TLS_REJECT_UNAUTHORIZED/, '전역 검증 해제 금지')
  })

  it('★ 302 + Set-Cookie 를 받으면 쿠키를 달고 다시 간다 — 이게 없으면 영원히 302다', () => {
    const src = read(MOD)
    assert.match(src, /set-cookie/i, '받은 쿠키를 읽어야 한다')
    assert.match(src, /Cookie:\s*cookie/, '2회차 요청에 쿠키를 실어야 한다')
    assert.match(src, /first\.status === 200/, '1회차가 200이면 그대로 쓴다')
  })

  it('시간 제한이 있다 — 외부 API 가 안 끊어 주면 라우트가 함수 상한까지 매달린다', () => {
    assert.ok(KOREAEXIM_TIMEOUT_MS > 0 && KOREAEXIM_TIMEOUT_MS <= 30_000)
    assert.match(read(MOD), /req\.on\('timeout'/)
  })

  it('실패를 던지지 않는다 — 호출부가 직전 영업일로 폴백할 수 있어야 한다', () => {
    const src = read(MOD)
    assert.match(src, /Promise<unknown \| null>/, '실패는 null 로 돌려준다')
    assert.match(src, /req\.on\('error', \(\) => resolve/, '네트워크 오류도 던지지 않는다')
  })

  it('★ 이 서버를 부르는 곳은 전부 SSOT 를 쓴다 — 맨 fetch 가 하나라도 남으면 그 화면만 죽는다', () => {
    const callers = ['app/api/pricing/gpu/fx/route.ts', 'app/admin/settings/actions.ts']
    for (const p of callers) {
      const src = read(p)
      assert.match(src, /fetchKoraeximJson/, `${p} 가 SSOT 를 써야 한다`)
      assert.doesNotMatch(src, /fetch\([^)]*oapi\.koreaexim/,
        `${p} 에 맨 fetch 가 남아 있다 — TLS·쿠키 처리를 건너뛴다`)
    }
  })

  it('주소는 한 곳에서만 정한다', () => {
    assert.match(KOREAEXIM_BASE, /^https:\/\/oapi\.koreaexim\.go\.kr\//)
  })
})

describe('CSS Module — 로컬 클래스 없는 선택자를 넣지 않는다', () => {
  /** :global(...) 또는 :global { 이 **선택자 전체**인 줄 — pure mode 가 거부한다 */
  const GLOBAL_ONLY = /^\s*:global\s*(\([^)]*\))?\s*\{/

  function modules(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${e}`
      if (e === 'node_modules' || e.startsWith('.')) continue
      if (statSync(join(process.cwd(), rel)).isDirectory()) modules(rel, out)
      else if (e.endsWith('.module.css')) out.push(rel)
    }
    return out
  }

  it('가드가 실제로 파일을 훑는다 — 0개를 훑고 통과하면 가드가 아니다', () => {
    const found = [...modules('app'), ...modules('components')]
    assert.ok(found.length > 3, `CSS Module 을 ${found.length}개만 찾았다 — 스캐너가 헛돈다`)
  })

  it('★ 전역 전용 선택자가 없다 — 이 한 줄이 공유 dev 서버의 전 라우트를 죽였다', () => {
    const bad: string[] = []
    for (const p of [...modules('app'), ...modules('components')]) {
      read(p).split('\n').forEach((line, i) => {
        if (GLOBAL_ONLY.test(line)) bad.push(`${p}:${i + 1}  ${line.trim()}`)
      })
    }
    assert.deepEqual(bad, [],
      'CSS Module 은 선택자마다 로컬 클래스가 있어야 한다(pure mode).\n' +
      '전역으로 걸어야 하는 규칙이면 globals.css 로 옮긴다.\n' + bad.join('\n'))
  })
})
