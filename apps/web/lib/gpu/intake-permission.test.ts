import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// GPU 통합입력 권한 경계 가드 (SSOT).
// 정책: "제출(검토대기 적재)=내부 임직원(member+admin) / 확정·라이브반영·마스터CRUD=admin 전용".
// 게이트가 회귀로 뒤바뀌면(예: 제출이 다시 admin-only, 확정이 member로 개방) 즉시 실패한다.
// (092_rls_hardening: 대상 테이블은 service_role로만 쓰므로 앱 레이어 게이트가 유일한 접근통제 → 이 가드가 방어선)

const API_ROOT = join(process.cwd(), 'app/api/pricing/gpu')

function gateOf(relPath: string): 'member' | 'admin' | 'none' {
  const src = readFileSync(join(API_ROOT, relPath), 'utf8')
  const usesMember = /await\s+requireMemberApi\(\)/.test(src)
  const usesAdmin = /await\s+requireAdminApi\(\)/.test(src)
  if (usesMember && !usesAdmin) return 'member'
  if (usesAdmin && !usesMember) return 'admin'
  if (!usesMember && !usesAdmin) return 'none'
  // 한 파일에 둘 다 — GET/POST가 다른 게이트일 수 있어 여기선 판정 불가로 처리
  return 'none'
}

// 제출 경로: member 허용이어야 한다 (member가 통합입력을 정상 사용)
// market/import: member도 게이트 통과하되 내부 role 분기 — member는 검토대기 staging, admin만 라이브 반영(아래 별도 단언).
const MEMBER_SUBMIT_ROUTES = [
  'review/stream/route.ts',   // 추출/미리보기 (DB 쓰기 없음)
  'review/commit/route.ts',   // 검토대기(review_items) 저장 = 제출
  'market/catalog/route.ts',  // 엑셀/CSV → 검토대기 적재 = 제출
  'market/import/route.ts',   // 경쟁사 반영: member=검토대기 staging / admin=라이브(내부 role 분기)
]

// 확정/라이브반영(라우트 게이트가 admin) 경로
const ADMIN_CONFIRM_ROUTES = [
  'review/bulk/route.ts',     // 검토 일괄 처리
]

test('통합입력 제출 경로는 member 허용(requireMemberApi)', () => {
  for (const r of MEMBER_SUBMIT_ROUTES) {
    assert.equal(gateOf(r), 'member', `${r} 는 requireMemberApi 여야 함(제출=임직원 허용)`)
  }
})

test('확정/라이브반영 경로는 admin 유지(requireAdminApi)', () => {
  assert.equal(gateOf('review/bulk/route.ts'), 'admin', 'review/bulk(검토 일괄)은 admin 유지')
})

// market/import는 member 게이트지만, 라이브 반영(saveCompetitorPrices)은 내부 role 분기로 admin만 도달해야 한다.
// member 분기는 review_items(검토대기)로 staging. 이 가드가 깨지면(=member가 라이브 반영) 즉시 실패.
test('market/import는 내부 role 분기로 라이브반영을 admin에 한정(member는 검토대기 staging)', () => {
  const src = readFileSync(join(API_ROOT, 'market/import/route.ts'), 'utf8')
  assert.match(src, /role\s*!==\s*'admin'/, 'member(비admin) 분기로 staging 경로가 있어야 함')
  assert.match(src, /target:\s*'competitor'/, 'member 분기는 review_items(target=competitor)로 staging 해야 함')
  assert.match(src, /saveCompetitorPrices/, 'admin 분기는 saveCompetitorPrices로 라이브 반영')
})

test('마스터데이터 CRUD는 admin 유지(requireAdminApi)', () => {
  assert.equal(gateOf('competitors/[id]/route.ts'), 'admin', '경쟁사 단건 CRUD는 admin 유지')
  assert.equal(gateOf('suppliers/bulk/route.ts'), 'admin', '공급사 일괄은 admin 유지')
})

void ADMIN_CONFIRM_ROUTES
