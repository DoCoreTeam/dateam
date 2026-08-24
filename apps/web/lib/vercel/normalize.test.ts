// lib/vercel/normalize.ts 가드 — Vercel 의 말이 우리 화면의 말로 바뀌는지
//
// 특히 셋: ① 요청 로그는 level 이 info 인데 상태 코드가 5xx 일 수 있다(그건 실패다)
//         ② 로그 본문에 키가 섞여 들어올 수 있다(마스킹은 시스템 로그와 **같은 것**을 쓴다)
//         ③ 없는 값을 지어내지 않는다(target 이 null 인 배포가 실제로 온다)

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isFailure, normalizeDeployEvent, normalizeDeployment } from './normalize.ts'
import { readVercelConfig, maskToken } from './config.ts'
import type { VercelDeployEvent, VercelDeployment } from './api.ts'

function log(over: Partial<VercelDeployEvent> = {}): VercelDeployEvent {
  return { id: 'e1', type: 'stdout', text: 'hello', date: 1_700_000_000_000, ...over }
}

function deploy(over: Partial<VercelDeployment> = {}): VercelDeployment {
  return {
    uid: 'dpl_1', name: 'web', url: 'web-abc.vercel.app', readyState: 'READY', state: 'READY',
    created: 1_700_000_000_000, target: 'production', inspectorUrl: 'https://vercel.com/i/1', ...over,
  }
}

describe('배포 로그', () => {
  it('Vercel 이 오류라고 표시한 줄만 실패로 센다', () => {
    const r = normalizeDeployEvent(log({ level: 'error', text: 'Build failed' }))
    assert.equal(r.status, 'blocker')
    assert.equal(r.levelLabel, '오류')
    assert.equal(isFailure(r), true)
  })

  it('★ stderr 라는 것만으로 실패로 세지 않는다 — npm·next 가 경고를 stderr 로 뱉는다', () => {
    // 실측: 한 배포의 stderr 129줄 중 Vercel 이 오류로 표시한 것은 33줄뿐이었다.
    // 이 구분이 없으면 목록이 통째로 빨개져서 진짜 오류가 묻힌다.
    const r = normalizeDeployEvent(log({ type: 'stderr', text: 'npm warn deprecated' }))
    assert.equal(r.level, 'info')
    assert.equal(isFailure(r), false)
  })

  it('경고는 경고로 남긴다', () => {
    const r = normalizeDeployEvent(log({ level: 'warning' }))
    assert.equal(r.levelLabel, '주의')
    assert.equal(isFailure(r), true)
  })

  it('fatal 은 level 이 없어도 오류다', () => {
    assert.equal(normalizeDeployEvent(log({ type: 'fatal' })).level, 'error')
  })

  it('빌드 단계 이름이 있으면 그것을 보여 준다 — stdout 은 관리자에게 뜻이 없다', () => {
    assert.equal(normalizeDeployEvent(log({ info: { name: 'bld_abc' } })).sourceLabel, 'bld_abc')
    assert.equal(normalizeDeployEvent(log({ type: 'stdout' })).sourceLabel, '빌드 출력')
  })

  it('본문의 키를 지운다 — 시스템 로그와 같은 마스커를 쓴다', () => {
    const r = normalizeDeployEvent(log({ text: 'boom key=AIzaSyD1234567890abcdefghijklmnopqrstu end' }))
    assert.doesNotMatch(r.message, /AIzaSyD1234567890abcdefghijklmnopqrstu/)
  })

  it('아주 긴 본문은 자르고 잘랐다고 말한다', () => {
    const r = normalizeDeployEvent(log({ text: 'x'.repeat(5000) }))
    assert.ok(r.message.length < 5000)
    assert.equal(r.truncated, true)
  })

  it('시각은 ISO 로 준다 — KST 변환은 화면이 SSOT 로 한다', () => {
    const r = normalizeDeployEvent(log({ date: Date.UTC(2026, 7, 24, 6, 57, 52) }))
    assert.equal(r.at, '2026-08-24T06:57:52.000Z')
  })
})

describe('배포', () => {
  it('ERROR 는 지금 막힌 것으로 읽는다', () => {
    const d = normalizeDeployment(deploy({ state: 'ERROR', readyState: 'ERROR' }))
    assert.equal(d.status, 'blocker')
    assert.equal(d.stateLabel, '배포 실패')
  })

  it('target 이 없으면 지어내지 않는다', () => {
    assert.equal(normalizeDeployment(deploy({ target: null })).target, '미지정')
  })

  it('커밋 정보를 Git 제공자와 무관하게 뽑는다', () => {
    const d = normalizeDeployment(deploy({
      meta: { githubCommitMessage: '  로그 화면 추가  ', githubCommitRef: 'main', githubCommitAuthorName: 'DOCORE' },
    }))
    assert.equal(d.commitMessage, '로그 화면 추가')
    assert.equal(d.branch, 'main')
    assert.equal(d.author, 'DOCORE')
  })

  it('빈 문자열 메타는 null 이다 — "있는데 비었다"로 읽히면 안 된다', () => {
    const d = normalizeDeployment(deploy({ meta: { githubCommitMessage: '   ' } }))
    assert.equal(d.commitMessage, null)
  })

  it('배포 오류 문구에서도 키를 지운다', () => {
    const d = normalizeDeployment(deploy({
      state: 'ERROR', readyState: 'ERROR',
      errorMessage: 'build failed sk-abcdefghijklmnopqrstuvwxyz012345678901234567',
    }))
    assert.doesNotMatch(d.errorMessage ?? '', /sk-abcdefghijklmnopqrstuvwxyz/)
  })
})

describe('설정', () => {
  it('연동이 안 된 것과 로그가 0건인 것을 구분해 말한다', () => {
    const r = readVercelConfig({})
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.reason, 'no-token')
      assert.match(r.message, /시스템 설정/)
    }
  })

  it('토큰만 있고 프로젝트가 없으면 그 사실을 따로 말한다', () => {
    const r = readVercelConfig({ vercel_api_token: 'tok' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, 'no-project')
  })

  it('공백만 든 값은 없는 것으로 본다', () => {
    const r = readVercelConfig({ vercel_api_token: '   ', vercel_project_id: 'prj' })
    assert.equal(r.ok, false)
  })

  it('팀 ID 는 없어도 된다(개인 프로젝트)', () => {
    const r = readVercelConfig({ vercel_api_token: 'tok', vercel_project_id: 'prj' })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.config.teamId, null)
  })

  it('토큰은 앞뒤만 남긴다', () => {
    const m = maskToken('AbCdEfGhIjKlMnOpQrSt')
    assert.match(m, /^AbCdE••••••••QrSt$/)
    assert.doesNotMatch(m, /FgHiJkLmNoP/)
  })
})
