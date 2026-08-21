import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  injectWorkspaceFilter,
  classifyModel,
  isCrmModel,
  TENANT_FREE,
  TENANT_NULLABLE,
  WORKSPACE_SELF,
  PARENT_SCOPED,
  SOFT_DELETE_MODELS,
} from './workspace-guard.ts'
import { CrmError } from '../domain/errors.ts'

const WS = 'ws_mine'
const OTHER = 'ws_theirs'

// ------------------------------------------------------------
// 완료 기준 ①: 필터 자동 주입
// ------------------------------------------------------------

test('where 가 없으면 workspaceId 조건을 만들어 넣는다', () => {
  const out = injectWorkspaceFilter({}, WS, 'findMany', 'CrmDeal') as Record<string, any>
  // deletedAt: null 도 함께 붙는다 — 소프트 삭제 모델이기 때문(아래 별도 테스트 참조)
  assert.deepEqual(out.where, { workspaceId: WS, deletedAt: null })
})

test('where 가 이미 있으면 기존 조건을 보존한 채 workspaceId 만 더한다', () => {
  const out = injectWorkspaceFilter(
    { where: { status: 'OPEN' }, take: 20 },
    WS, 'findMany', 'CrmDeal',
  ) as Record<string, any>
  assert.deepEqual(out.where, { status: 'OPEN', workspaceId: WS, deletedAt: null })
  assert.equal(out.take, 20, '다른 인자는 그대로 유지되어야 한다')
})

test('create 의 data 에도 workspaceId 를 넣는다', () => {
  const out = injectWorkspaceFilter(
    { data: { name: '데이터얼라이언스' } },
    WS, 'create', 'CrmCompany',
  ) as Record<string, any>
  assert.deepEqual(out.data, { name: '데이터얼라이언스', workspaceId: WS })
})

test('createMany 는 배열 전 항목에 넣는다', () => {
  const out = injectWorkspaceFilter(
    { data: [{ name: 'A' }, { name: 'B' }] },
    WS, 'createMany', 'CrmCompany',
  ) as Record<string, any>
  assert.deepEqual(out.data, [
    { name: 'A', workspaceId: WS },
    { name: 'B', workspaceId: WS },
  ])
})

test('upsert 는 where 와 create 양쪽에 넣는다', () => {
  const out = injectWorkspaceFilter(
    { where: { id: 'c1' }, create: { name: 'A' }, update: { name: 'B' } },
    WS, 'upsert', 'CrmCompany',
  ) as Record<string, any>
  assert.deepEqual(out.where, { id: 'c1', workspaceId: WS })
  assert.deepEqual(out.create, { name: 'A', workspaceId: WS })
})

test('update·delete·count·aggregate·groupBy 전부 주입된다', () => {
  for (const op of ['update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy',
                    'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow']) {
    const out = injectWorkspaceFilter({ where: { id: 'x' } }, WS, op, 'CrmDeal') as Record<string, any>
    assert.equal(out.where.workspaceId, WS, `${op} 에 주입되지 않았다`)
  }
})

test('원본 args 를 변형하지 않는다 (불변성)', () => {
  const original = { where: { status: 'OPEN' } }
  const out = injectWorkspaceFilter(original, WS, 'findMany', 'CrmDeal')
  assert.deepEqual(original, { where: { status: 'OPEN' } }, '원본이 변형됐다')
  assert.notEqual(out, original)
})

// ------------------------------------------------------------
// 완료 기준 ②: 불일치 workspaceId 예외
// ------------------------------------------------------------

test('where 에 남의 workspaceId 를 명시하면 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter({ where: { workspaceId: OTHER } }, WS, 'findMany', 'CrmDeal'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('create data 에 남의 workspaceId 를 심어도 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter({ data: { name: 'A', workspaceId: OTHER } }, WS, 'create', 'CrmCompany'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('createMany 배열 중 한 건만 남의 것이어도 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter(
      { data: [{ name: 'A' }, { name: 'B', workspaceId: OTHER }] },
      WS, 'createMany', 'CrmCompany',
    ),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('같은 workspaceId 를 명시하는 것은 통과한다', () => {
  const out = injectWorkspaceFilter(
    { where: { workspaceId: WS, status: 'OPEN' } }, WS, 'findMany', 'CrmDeal',
  ) as Record<string, any>
  assert.deepEqual(out.where, { workspaceId: WS, status: 'OPEN', deletedAt: null })
})

test('workspaceId 가 빈 문자열이면 던진다 (세션 해석 실패를 조용히 넘기지 않는다)', () => {
  assert.throws(
    () => injectWorkspaceFilter({}, '', 'findMany', 'CrmDeal'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('오류가 남의 workspaceId 를 사용자 문장에 노출하지 않는다', () => {
  try {
    injectWorkspaceFilter({ where: { workspaceId: OTHER } }, WS, 'findMany', 'CrmDeal')
    assert.fail('던졌어야 한다')
  } catch (e) {
    assert.ok(e instanceof CrmError)
    assert.equal(e.message.includes(OTHER), false, 'message 에 타 워크스페이스 id 가 보인다')
  }
})

// ------------------------------------------------------------
// 완료 기준 ③: TENANT_FREE 통과
// ------------------------------------------------------------

test('TENANT_FREE(CrmExchangeRate) 는 args 를 그대로 통과시킨다', () => {
  const args = { where: { base: 'USD' } }
  const out = injectWorkspaceFilter(args, WS, 'findMany', 'CrmExchangeRate')
  assert.equal(out, args, '동일 참조로 통과해야 한다')
})

test('Crm 으로 시작하지 않는 모델은 가드 대상이 아니다', () => {
  assert.equal(isCrmModel('Profile'), false)
  assert.equal(isCrmModel(undefined), false)
  assert.equal(isCrmModel('CrmDeal'), true)
})

// ------------------------------------------------------------
// 추가: 명세가 전제하지 않은 3가지 분류 (실제 스키마가 그렇게 생겼다)
// ------------------------------------------------------------

test('CrmWorkspace 는 자기 id 로 판정한다', () => {
  const out = injectWorkspaceFilter({}, WS, 'findMany', 'CrmWorkspace') as Record<string, any>
  assert.deepEqual(out.where, { id: WS, deletedAt: null })
})

test('CrmWorkspace 에 남의 id 를 주면 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter({ where: { id: OTHER } }, WS, 'findUnique', 'CrmWorkspace'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('CrmWorkspace create 는 workspaceId 가 아니라 id 에 넣는다', () => {
  // 회귀: workspaceId 를 넣으면 그런 컬럼이 없어 Prisma 가 Unknown argument 로 던진다.
  // 시드(T0-07)가 가장 먼저 밟는 자리다.
  const out = injectWorkspaceFilter(
    { data: { name: '데이터얼라이언스' } }, WS, 'create', 'CrmWorkspace',
  ) as Record<string, any>
  assert.deepEqual(out.data, { name: '데이터얼라이언스', id: WS })
  assert.equal('workspaceId' in out.data, false, 'CrmWorkspace 에는 workspaceId 컬럼이 없다')
})

test('CrmWorkspace upsert 의 create 도 id 로 넣는다', () => {
  const out = injectWorkspaceFilter(
    { where: { id: WS }, create: { name: 'A' }, update: {} }, WS, 'upsert', 'CrmWorkspace',
  ) as Record<string, any>
  assert.equal(out.create.id, WS)
  assert.equal('workspaceId' in out.create, false)
})

test('CrmWorkspace create 에 남의 id 를 심으면 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter({ data: { id: OTHER, name: 'A' } }, WS, 'create', 'CrmWorkspace'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('CrmAppSetting 읽기는 GLOBAL(null) 과 내 워크스페이스를 함께 본다', () => {
  const out = injectWorkspaceFilter({}, WS, 'findMany', 'CrmAppSetting') as Record<string, any>
  assert.deepEqual(out.where, { OR: [{ workspaceId: null }, { workspaceId: WS }] })
})

test('CrmAppSetting 에 GLOBAL(null) 을 명시하면 존중한다', () => {
  const out = injectWorkspaceFilter(
    { where: { workspaceId: null } }, WS, 'findMany', 'CrmAppSetting',
  ) as Record<string, any>
  assert.deepEqual(out.where, { workspaceId: null })
})

test('CrmAppSetting 에 남의 workspaceId 를 명시하면 던진다', () => {
  assert.throws(
    () => injectWorkspaceFilter({ where: { workspaceId: OTHER } }, WS, 'findMany', 'CrmAppSetting'),
    (e: unknown) => e instanceof CrmError && e.code === 'WORKSPACE_MISMATCH',
  )
})

test('CrmAppSetting create 에 null 을 주면 GLOBAL 로 남는다', () => {
  const out = injectWorkspaceFilter(
    { data: { scope: 'GLOBAL', key: 'ai.model.extract', workspaceId: null, valueJson: {} } },
    WS, 'create', 'CrmAppSetting',
  ) as Record<string, any>
  assert.equal(out.data.workspaceId, null)
})

test('PARENT_SCOPED 모델은 주입 대상이 없으므로 그대로 통과한다', () => {
  for (const m of PARENT_SCOPED) {
    const args = { where: { id: 'x' } }
    assert.equal(
      injectWorkspaceFilter(args, WS, 'findMany', m), args,
      `${m} 에 주입을 시도하면 Prisma 가 Unknown argument 로 던진다`,
    )
  }
})

// ------------------------------------------------------------
// 분류표가 스키마와 어긋나면 실패한다 (모델을 추가하고 분류를 빠뜨리는 사고 차단)
// ------------------------------------------------------------

const SCHEMA_PATH = join(import.meta.dirname, '..', '..', '..', 'prisma', 'schema.prisma')

function modelsFromSchema(): { name: string; hasWorkspaceId: boolean }[] {
  const src = readFileSync(SCHEMA_PATH, 'utf8')
  const out: { name: string; hasWorkspaceId: boolean }[] = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    out.push({ name: m[1], hasWorkspaceId: /^\s*workspaceId\s+String/m.test(m[2]) })
  }
  return out
}

test('스키마의 모든 Crm 모델이 정확히 하나의 분류에 속한다', () => {
  const models = modelsFromSchema()
  assert.ok(models.length >= 24, `모델을 못 읽었다 (${models.length}개)`)
  for (const { name } of models) {
    const hits = [TENANT_FREE, TENANT_NULLABLE, WORKSPACE_SELF, PARENT_SCOPED]
      .filter((s) => s.has(name)).length
    assert.ok(hits <= 1, `${name} 이 두 분류에 동시에 들어 있다`)
  }
})

test('workspaceId 가 없는 모델은 direct 로 분류되면 안 된다', () => {
  // direct 분류는 workspaceId 주입을 시도한다. 컬럼이 없으면 런타임에 Prisma 가 던진다.
  for (const { name, hasWorkspaceId } of modelsFromSchema()) {
    if (hasWorkspaceId) continue
    assert.notEqual(
      classifyModel(name), 'direct',
      `${name} 은 workspaceId 필드가 없는데 direct 로 분류돼 주입 대상이 된다`,
    )
  }
})

test('workspaceId 를 가진 모델은 free/parent 로 새어 나가지 않는다', () => {
  for (const { name, hasWorkspaceId } of modelsFromSchema()) {
    if (!hasWorkspaceId) continue
    const cls = classifyModel(name)
    assert.ok(
      cls === 'direct' || cls === 'nullable',
      `${name} 은 workspaceId 가 있는데 ${cls} 로 분류돼 격리가 걸리지 않는다`,
    )
  }
})

// ------------------------------------------------------------
// 소프트 삭제 자동 필터 (통합기획서 v0.2.1 473행 + 사용자 결정: 소프트 + 즉시삭제 선택)
// ------------------------------------------------------------

test('소프트 삭제 모델의 조회에는 deletedAt: null 이 자동으로 붙는다', () => {
  for (const m of SOFT_DELETE_MODELS) {
    const out = injectWorkspaceFilter({}, WS, 'findMany', m) as Record<string, any>
    assert.equal(out.where.deletedAt, null, `${m} 에 삭제 필터가 안 붙었다 — 지운 것이 목록에 되살아난다`)
  }
})

test('휴지통처럼 삭제된 것을 일부러 보려면 명시한다 — 명시하면 존중한다', () => {
  const out = injectWorkspaceFilter(
    { where: { deletedAt: { not: null } } }, WS, 'findMany', 'CrmCompany',
  ) as Record<string, any>
  assert.deepEqual(out.where.deletedAt, { not: null }, '휴지통을 열 수 없다')
})

test('영구 삭제(delete/deleteMany)에는 삭제 필터를 붙이지 않는다', () => {
  // 붙이면 휴지통 비우기가 0건이 되어 아무 일도 안 일어난다
  for (const op of ['delete', 'deleteMany']) {
    const out = injectWorkspaceFilter({ where: { id: 'c1' } }, WS, op, 'CrmCompany') as Record<string, any>
    assert.equal('deletedAt' in out.where, false, `${op} 에 삭제 필터가 붙었다`)
  }
})

test('복구(update)는 삭제된 행을 명시해 되살릴 수 있다', () => {
  const out = injectWorkspaceFilter(
    { where: { id: 'c1', deletedAt: { not: null } }, data: { deletedAt: null } },
    WS, 'update', 'CrmCompany',
  ) as Record<string, any>
  assert.deepEqual(out.where.deletedAt, { not: null })
})

test('deletedAt 컬럼이 없는 모델에는 붙이지 않는다 (Prisma 가 Unknown argument 로 던진다)', () => {
  const out = injectWorkspaceFilter({}, WS, 'findMany', 'CrmAiRun') as Record<string, any>
  assert.equal('deletedAt' in out.where, false, 'CrmAiRun 에는 deletedAt 컬럼이 없다')
})

test('소프트 삭제 분류가 스키마와 일치한다 (모델 추가 시 빠뜨림 차단)', () => {
  const models = modelsFromSchema2()
  for (const { name, hasDeletedAt } of models) {
    assert.equal(
      SOFT_DELETE_MODELS.has(name), hasDeletedAt,
      `${name}: 스키마 deletedAt=${hasDeletedAt} 인데 분류는 ${SOFT_DELETE_MODELS.has(name)}`,
    )
  }
})

function modelsFromSchema2(): { name: string; hasDeletedAt: boolean }[] {
  const src = readFileSync(SCHEMA_PATH, 'utf8')
  const out: { name: string; hasDeletedAt: boolean }[] = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    out.push({ name: m[1], hasDeletedAt: /^\s*deletedAt\s+DateTime/m.test(m[2]) })
  }
  return out
}

// ── 삭제 범위 판정은 AND 로 감싼 조건도 본다 (v0.7.576) ────────────────
//
// 실측: 견적 휴지통이 `?trash=1` 이면 15건, `?trash=1&q=…` 면 0건이었다.
// 검색이 붙으면 조건이 `{ AND: [where, search, cursor] }` 로 감싸이는데,
// 그때 `deletedAt` 이 맨 위에서 사라져 가드가 `deletedAt: null` 을 덧붙였다.
// 지운 것이 있는데 검색만 하면 사라지니 되돌릴 길이 없었다.

test('AND 로 감싼 휴지통 조건에 삭제 필터를 덧붙이지 않는다', () => {
  const out = injectWorkspaceFilter(
    { where: { AND: [{ deletedAt: { not: null } }, { title: { contains: 'x' } }] } },
    WS, 'findMany', 'CrmQuote',
  ) as Record<string, any>
  assert.equal('deletedAt' in out.where, false,
    'AND 바깥에 deletedAt: null 이 붙으면 안쪽 {not: null} 과 모순되어 0건이 된다')
})

test('AND 안에 삭제 범위가 없으면 여전히 살아 있는 행만 본다', () => {
  const out = injectWorkspaceFilter(
    { where: { AND: [{ status: 'DRAFT' }, { title: { contains: 'x' } }] } },
    WS, 'findMany', 'CrmQuote',
  ) as Record<string, any>
  assert.equal(out.where.deletedAt, null, '지운 견적이 일반 목록에 되살아난다')
})

test('OR·NOT 안의 deletedAt 은 범위 선언으로 읽지 않는다 — 깊이 뒤지면 되살아난다', () => {
  const out = injectWorkspaceFilter(
    { where: { OR: [{ deletedAt: { not: null } }, { title: { contains: 'x' } }] } },
    WS, 'findMany', 'CrmQuote',
  ) as Record<string, any>
  assert.equal(out.where.deletedAt, null)
})
