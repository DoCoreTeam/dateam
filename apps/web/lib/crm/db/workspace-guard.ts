/**
 * 워크스페이스 가드 — 앱 계층 방어 (구현명세서 2.2)
 *
 * 이 파일은 Prisma 를 import 하지 않는다. 순수 함수만 둔다.
 * 왜: Prisma Client Extension 안에서 돌아가는 로직이 곧 격리의 전부인데,
 *     Prisma 인스턴스가 있어야만 테스트할 수 있으면 그 로직은 사실상 검증되지 않는다.
 *     여기(순수) / client.ts(결선)로 나누면 격리 규칙 자체를 단위 테스트로 못 박을 수 있다.
 *
 * ⚠️ 명세 2.2 의 전제 하나가 실제 스키마와 다르다 — 그대로 구현하면 깨진다.
 *    명세는 "전 테이블 workspaceId 필수"라고 했지만, crm_schema_v0.1.0.prisma 실측 결과
 *    24개 모델 중 workspaceId 필드를 가진 것은 17개뿐이다.
 *    나머지 7개에 workspaceId 를 주입하면 Prisma 가 "Unknown argument" 로 즉시 던진다.
 *    그래서 모델을 5가지로 분류한다(199_crm_rls_check.sql 의 RLS 정책 분기와 같은 분류다).
 */

import { CrmError } from '../domain/errors.ts'

/** ① 테넌트 무관 — 아무것도 주입하지 않는다. 환율은 워크스페이스 공용 데이터다. */
export const TENANT_FREE: ReadonlySet<string> = new Set(['CrmExchangeRate'])

/**
 * ② workspaceId 가 nullable — GLOBAL 행(workspaceId = null)이 존재한다.
 *    읽기: 내 워크스페이스 것 + GLOBAL 둘 다 보여야 한다(OR).
 *    쓰기: 명시하지 않으면 내 워크스페이스로, null 을 명시하면 GLOBAL 로 둔다.
 *    ※ 통째로 TENANT_FREE 로 두면 남의 워크스페이스 설정까지 보인다. 그래서 별도 분류다.
 */
export const TENANT_NULLABLE: ReadonlySet<string> = new Set(['CrmAppSetting'])

/** ③ 자기 id 가 곧 워크스페이스 식별자 */
export const WORKSPACE_SELF: ReadonlySet<string> = new Set(['CrmWorkspace'])

/**
 * ④ workspaceId 컬럼이 없고 부모를 통해서만 소속이 정해지는 모델.
 *    주입 대상이 없으므로 여기서는 통과시키고, 격리는 부모 레코드를 거치는 접근 경로와
 *    DB 의 RLS 자식 정책(199)이 담당한다.
 *    ※ 서비스 계층은 이 모델들을 **부모를 경유해서만** 조회해야 한다. 직접 findMany 하지 않는다.
 */
export const PARENT_SCOPED: ReadonlySet<string> = new Set([
  'CrmStage',
  'CrmDealContact',
  'CrmStageHistory',
  'CrmMeetingRecording',
  'CrmTranscriptSegment',
  // 견적 항목은 견적을 통해서만 닿는다 — 항목만 따로 조회하는 화면은 없다
  'CrmQuoteLine',
])

/** ⑤ 위 어디에도 없으면 workspaceId 를 직접 가진 모델로 본다(17 - CrmAppSetting = 16개). */
export type ModelClass = 'free' | 'nullable' | 'self' | 'parent' | 'direct'

export function classifyModel(model: string): ModelClass {
  if (TENANT_FREE.has(model)) return 'free'
  if (TENANT_NULLABLE.has(model)) return 'nullable'
  if (WORKSPACE_SELF.has(model)) return 'self'
  if (PARENT_SCOPED.has(model)) return 'parent'
  return 'direct'
}

export function isCrmModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('Crm')
}

/**
 * 소프트 삭제(deletedAt)를 가진 모델 — 통합기획서 v0.2.1 473행 "소프트 삭제 기본"
 *
 * 워크스페이스 필터와 **같은 방식으로** 자동 주입한다. 이유도 같다:
 * 화면마다 `deletedAt: null` 을 손으로 붙이게 하면 언젠가 한 곳을 빠뜨리고,
 * 그 화면에서만 지운 데이터가 되살아난다. 붙이는 것을 잊을 수 없게 만든다.
 *
 * 휴지통처럼 삭제된 것을 **일부러** 보려면 호출부가 deletedAt 을 명시한다
 * (`where: { deletedAt: { not: null } }`). 명시하면 그대로 존중한다.
 */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = new Set([
  'CrmWorkspace', 'CrmMember', 'CrmCompany', 'CrmPerson',
  'CrmPipeline', 'CrmDeal', 'CrmActivity', 'CrmTask', 'CrmMeeting',
  // 견적·상품도 휴지통을 갖는다 — 보낸 견적을 실수로 지웠을 때 되돌릴 수 있어야 한다.
  // (항목 CrmQuoteLine 은 견적을 따라가므로 자체 삭제 시각을 두지 않는다)
  'CrmProduct', 'CrmQuote',
])

/**
 * 삭제 필터를 주입할 연산.
 * delete·deleteMany 는 **일부러 뺐다** — 휴지통 비우기(영구 삭제)는 이미 삭제된 행을 노린다.
 * 여기에 deletedAt: null 을 넣으면 휴지통에서 영구 삭제가 0건이 되어 아무 일도 안 일어난다.
 * create·upsert 도 뺐다 — upsert 의 where 에 넣으면 소프트 삭제된 같은 id 를 못 보고
 * create 로 가서 PK 충돌이 난다.
 */
const SOFT_DELETE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany',
])

/** where 를 갖는 연산 */
const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'update', 'updateMany', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy',
])

/** data 를 갖는 연산 */
const DATA_OPS = new Set(['create', 'createMany'])

type Args = Record<string, unknown>

function mismatch(model: string, field: string, got: unknown, expected: string): never {
  throw new CrmError('WORKSPACE_MISMATCH', '요청을 처리할 수 없습니다.', {
    model,
    field,
    got: got === undefined ? null : got,
    expected,
  })
}

/**
 * where 절에 workspaceId 를 강제한다.
 * 이미 있으면 값을 검증하고(불일치면 throw), 없으면 넣는다.
 */
function guardWhere(model: string, where: unknown, key: string, workspaceId: string): Args {
  const w: Args = (where && typeof where === 'object' ? { ...(where as Args) } : {})
  const existing = w[key]
  if (existing !== undefined && existing !== workspaceId) {
    mismatch(model, key, existing, workspaceId)
  }
  return { ...w, [key]: workspaceId }
}

/**
 * 호출부가 삭제 범위를 **어디에 적었든** 찾아낸다.
 *
 * 왜 맨 위만 보면 안 되나(v0.7.576 실측): 검색·커서가 붙는 목록은 조건을
 * `{ AND: [where, search, cursor] }` 로 감싼다. 그러면 `deletedAt` 은 `AND[0]` 안으로
 * 들어가고 맨 위에서는 사라진다. 맨 위만 보는 판정은 "호출부가 안 정했다"고 읽어
 * `deletedAt: null` 을 **덧붙이고**, `{not: null}` 과 만나 모순이 되어 **0건**이 된다.
 *
 * 실제로 견적 휴지통이 그랬다 — `?trash=1` 만이면 15건, `?trash=1&q=…` 면 0건.
 * 지운 것이 분명히 있는데 검색만 하면 사라지니, 사용자는 되돌릴 방법이 없었다.
 *
 * 한 겹만 본다(AND 배열의 직계). 더 깊은 중첩까지 뒤지면 `NOT`·`OR` 안의 조건을
 * "범위를 정했다"고 잘못 읽어 **삭제된 행이 일반 목록에 되살아난다.**
 */
function declaresDeleteScope(w: Args): boolean {
  if ('deletedAt' in w) return true
  const and = w.AND
  if (Array.isArray(and)) {
    return and.some((p) => p !== null && typeof p === 'object' && 'deletedAt' in (p as Args))
  }
  return and !== null && typeof and === 'object' && 'deletedAt' in (and as Args)
}

/**
 * 살아 있는 행만 보이게 한다. 호출부가 deletedAt 을 명시했으면 손대지 않는다(휴지통 등).
 */
function applySoftDelete(model: string, operation: string, where: unknown): Args {
  const w: Args = (where && typeof where === 'object' ? { ...(where as Args) } : {})
  if (!SOFT_DELETE_MODELS.has(model)) return w
  if (!SOFT_DELETE_OPS.has(operation)) return w
  if (declaresDeleteScope(w)) return w // 호출부가 스코프를 정했다 — 존중한다
  return { ...w, deletedAt: null }
}

/** create 의 data 한 건에 지정한 키를 강제한다. */
function guardCreateData(model: string, data: unknown, workspaceId: string, key = 'workspaceId'): Args {
  const d: Args = (data && typeof data === 'object' ? { ...(data as Args) } : {})
  const existing = d[key]
  if (existing !== undefined && existing !== workspaceId) {
    mismatch(model, key, existing, workspaceId)
  }
  return { ...d, [key]: workspaceId }
}

/**
 * WORKSPACE_SELF(CrmWorkspace) 의 create — 넣을 키는 workspaceId 가 아니라 id 다.
 * workspaceId 를 넣으면 그런 컬럼이 없어 Prisma 가 Unknown argument 로 던진다.
 */
function guardSelfCreateData(model: string, data: unknown, workspaceId: string): Args {
  return guardCreateData(model, data, workspaceId, 'id')
}

/** TENANT_NULLABLE 의 create — null(=GLOBAL)은 허용, 다른 워크스페이스 값은 거부 */
function guardNullableCreateData(model: string, data: unknown, workspaceId: string): Args {
  const d: Args = (data && typeof data === 'object' ? { ...(data as Args) } : {})
  const existing = d['workspaceId']
  if (existing === null) return d // GLOBAL 설정 — 그대로 둔다
  if (existing !== undefined && existing !== workspaceId) {
    mismatch(model, 'workspaceId', existing, workspaceId)
  }
  return { ...d, workspaceId }
}

/**
 * 연산 args 에 워크스페이스 조건을 주입한 **새 객체**를 돌려준다.
 * 원본 args 는 절대 변형하지 않는다(명세 2.2 예시는 in-place 변형이지만,
 * 이 저장소의 불변성 규칙을 따르고 호출부가 args 를 재사용해도 안전하게 만든다).
 */
export function injectWorkspaceFilter(
  args: unknown,
  workspaceId: string,
  operation: string,
  model: string,
): unknown {
  if (!workspaceId) {
    throw new CrmError('WORKSPACE_MISMATCH', '요청을 처리할 수 없습니다.', {
      model,
      reason: 'workspaceId 가 비어 있다',
    })
  }

  const cls = classifyModel(model)
  if (cls === 'free' || cls === 'parent') return args

  const a: Args = (args && typeof args === 'object' ? { ...(args as Args) } : {})

  // upsert 는 where + create + update 를 한꺼번에 갖는다
  if (operation === 'upsert') {
    const next: Args = { ...a }
    if (cls === 'self') {
      next.where = guardWhere(model, a.where, 'id', workspaceId)
      next.create = guardSelfCreateData(model, a.create, workspaceId) // CrmWorkspace 는 id 가 곧 워크스페이스다
    } else if (cls === 'nullable') {
      next.where = guardWhere(model, a.where, 'workspaceId', workspaceId)
      next.create = guardNullableCreateData(model, a.create, workspaceId)
    } else {
      next.where = guardWhere(model, a.where, 'workspaceId', workspaceId)
      next.create = guardCreateData(model, a.create, workspaceId)
    }
    return next
  }

  if (WHERE_OPS.has(operation)) {
    if (cls === 'self') {
      return { ...a, where: applySoftDelete(model, operation, guardWhere(model, a.where, 'id', workspaceId)) }
    }
    if (cls === 'nullable') {
      // GLOBAL(null) 과 내 워크스페이스를 함께 본다. 남의 워크스페이스는 어느 쪽으로도 안 걸린다.
      const w: Args = (a.where && typeof a.where === 'object' ? { ...(a.where as Args) } : {})
      const existing = w['workspaceId']
      if (existing !== undefined) {
        if (existing !== null && existing !== workspaceId) {
          mismatch(model, 'workspaceId', existing, workspaceId)
        }
        return { ...a, where: w } // 호출부가 스코프를 명시했으면 그대로 존중한다
      }
      return {
        ...a,
        where: { ...w, OR: [{ workspaceId: null }, { workspaceId }] },
      }
    }
    return { ...a, where: applySoftDelete(model, operation, guardWhere(model, a.where, 'workspaceId', workspaceId)) }
  }

  if (DATA_OPS.has(operation)) {
    const data = a.data
    const one =
      cls === 'nullable' ? guardNullableCreateData
      : cls === 'self' ? guardSelfCreateData
      : guardCreateData
    if (Array.isArray(data)) {
      return { ...a, data: data.map((d) => one(model, d, workspaceId)) }
    }
    return { ...a, data: one(model, data, workspaceId) }
  }

  // 분류에 없는 연산(findRaw 등)은 손대지 않는다. 손댈 근거가 없으면 건드리지 않는 편이 안전하다.
  return args
}
