/**
 * 조회 명령 500 셋의 회귀 시험 (P0170 I05)
 *
 * work project members: project_members 에서 profiles 로 가는 외래키가 셋이라 이름 없는 profiles(...) 가 PGRST201
 * work meeting-note get: 형식이 틀린 id 가 uuid 칼럼에서 22P02
 * trading settings preview-start: 인자 없이 부르면 answers.stance 에서 TypeError
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MEMBER_PROFILE } from './project-fields.ts'
import { isUuid } from '../postgrest-safe.ts'
import { isAnswers } from '../trading/settings/onboarding.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.next')) return []
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : []
  })
}

test('project_members 에 profiles 를 붙이는 자리는 외래키 이름을 고른다', () => {
  assert.match(MEMBER_PROFILE, /^profiles!project_members_user_id_fkey\(/)
  const bad: string[] = []
  for (const file of [...sources(join(WEB, 'app')), ...sources(join(WEB, 'lib'))]) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\('project_members'\)[\s\S]{0,200}?\.select\(([^)]*)\)/g)) {
      if (/\bprofiles\(/.test(m[1])) bad.push(relative(WEB, file))
    }
  }
  assert.deepEqual(bad, [])
})

test('isUuid 는 uuid 꼴만 참이다', () => {
  assert.equal(isUuid('7c9e6679-7425-40de-944b-e07fc1f90ae7'), true)
  assert.equal(isUuid('not-a-real-id'), false)
  assert.equal(isUuid(undefined), false)
})

test('isAnswers 는 빈 인자와 틀린 꼴을 거른다', () => {
  assert.equal(isAnswers(undefined), false)
  assert.equal(isAnswers({}), false)
  assert.equal(isAnswers({ stance: 'wild', targetKrw: 1, lossLimitKrw: 1 }), false)
  assert.equal(isAnswers({ stance: 'normal', targetKrw: '300000', lossLimitKrw: 1 }), false)
  assert.equal(isAnswers({ stance: 'normal', targetKrw: 300000, lossLimitKrw: 500000 }), true)
})
