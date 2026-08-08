import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normalizeError, ACTIVITY_ACTION_LABEL, ACTIVITY_STATUS_LABEL,
  type ProjectActivityAction, type ProjectActivityStatus,
} from './project-activity.ts'
import { hasProjectCrmRelationInput, parseProjectMeta } from './project-fields.ts'

test('normalizeError: Supabase 에러객체(message+code) 보존', () => {
  const out = normalizeError({ message: 'duplicate key', code: '23505' })
  assert.equal(out.message, 'duplicate key')
  assert.equal(out.code, '23505')
})

test('normalizeError: code 없는 객체는 code=null', () => {
  const out = normalizeError({ message: '연결 실패' })
  assert.equal(out.message, '연결 실패')
  assert.equal(out.code, null)
})

test('normalizeError: Error 인스턴스는 message 추출', () => {
  const out = normalizeError(new Error('boom'))
  assert.equal(out.message, 'boom')
})

test('normalizeError: 원시값은 문자열화', () => {
  assert.equal(normalizeError('그냥 문자열').message, '그냥 문자열')
  assert.equal(normalizeError(42).message, '42')
})

test('라벨 맵: 모든 action/status 키 커버', () => {
  const actions: ProjectActivityAction[] = ['create', 'update', 'delete', 'ai_confirm', 'link_daily', 'unlink_daily', 'member_change']
  for (const a of actions) assert.ok(ACTIVITY_ACTION_LABEL[a], `action 라벨 누락: ${a}`)
  const statuses: ProjectActivityStatus[] = ['success', 'failure', 'partial']
  for (const s of statuses) assert.ok(ACTIVITY_STATUS_LABEL[s], `status 라벨 누락: ${s}`)
})

const WEB_ROOT = resolve(import.meta.dirname, '../..')
const routeSource = (path: string) => readFileSync(resolve(WEB_ROOT, path), 'utf8')
const CRM_ROUTES = [
  'app/api/accounts/route.ts', 'app/api/accounts/[id]/route.ts',
  'app/api/accounts/fit-score/route.ts', 'app/api/contacts/route.ts',
  'app/api/contacts/[id]/route.ts', 'app/api/deals/route.ts',
  'app/api/deals/[id]/route.ts', 'app/api/deals/activities/route.ts',
  'app/api/deals/ai-parse/route.ts', 'app/api/lead-intakes/route.ts',
  'app/api/lead-intakes/[id]/route.ts',
]

test('CRM 프로젝트관리 API는 모두 관리자 게이트를 적용한다', () => {
  for (const route of CRM_ROUTES) {
    const source = routeSource(route)
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? []
    const gates = source.match(/await requireAdminApi\(\)/g) ?? []
    assert.match(source, /import \{ requireAdminApi \}/, `${route}: admin import`)
    assert.equal(gates.length, handlers.length, `${route}: 핸들러마다 admin gate`)
  }
})

test('AI 프로젝트 확정은 소유 업무만 서버 writer로 연결한다', () => {
  const source = routeSource('app/api/work/projects/confirm/route.ts')
  assert.match(source, /\.eq\('user_id', user\.id\).*\.in\('id', logIds\)/s)
  assert.match(source, /const writer = createAdminClient\(\)/)
  assert.match(source, /await writer\s*\.from\('work_entity_links'\)\s*\.upsert/s)
})

test('AI 후보는 표시한 업무 건수와 연결 ID 건수를 일치시킨다', () => {
  const source = routeSource('app/api/work/projects/suggest/route.ts')
  assert.match(source, /taskCount: ids\.length,\s*logIds: ids\.slice\(0, LINK_MAX\)/s)
  assert.doesNotMatch(source, /sampleLogIds|SAMPLE_MAX/)
})

test('프로젝트 공유 범위와 CRM 관계 필드를 엄격하게 검증한다', () => {
  assert.deepEqual(parseProjectMeta({ visibility: 'members', account_id: null }), {
    fields: { visibility: 'members', account_id: null },
  })
  assert.equal('error' in parseProjectMeta({ visibility: 'public' }), true)
  assert.equal('error' in parseProjectMeta({ account_id: 'not-uuid' }), true)
  assert.equal(hasProjectCrmRelationInput({ account_id: null }), true)
  assert.equal(hasProjectCrmRelationInput({ department_id: null }), false)
})

test('프로젝트 권한 마이그레이션은 기본 비공개·단일 판정·owner 보호를 유지한다', () => {
  const source = readFileSync(resolve(WEB_ROOT, '../../supabase/migrations/182_project_access_and_relations.sql'), 'utf8')
  assert.match(source, /visibility text NOT NULL DEFAULT 'private'/)
  assert.match(source, /FUNCTION private\.can_read_project/)
  assert.match(source, /role <> 'owner'/)
  assert.match(source, /ALTER TABLE project_members ADD COLUMN IF NOT EXISTS created_by/)
  assert.match(source, /ALTER TABLE project_members ALTER COLUMN role SET NOT NULL/)
  assert.match(source, /project_members_user_profile_fk/)
  assert.match(source, /guard_project_owner_change/)
  assert.match(source, /visibility <> 'department' OR department_id IS NOT NULL/)
  assert.match(source, /me\.role IN \('admin','member'\)/)
})
