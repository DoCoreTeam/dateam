/**
 * 계약 민감 등급 — 회사 단위 계약은 관리자만 본다 (P0184 I02)
 *
 * **판정은 DB 확장 한 자리에서 한다.** 계약을 읽는 길이 목록·단건·버전·비교·내보내기·서명·AI·검색·
 * 내 항목 열 곳이 넘는다. 함수마다 역할을 넘기게 하면 새 길 하나가 빠뜨리고, 빠뜨린 길은
 * 회사 기밀을 그대로 내준다. 워크스페이스 가드와 같은 자리(getCrmDb)에 거름망을 둔다.
 *
 * **문맥이 없으면 닫힌다.** 사람 확인을 안 거친 호출(잡·스크립트)은 역할을 모르므로
 * 관리자가 아닌 쪽으로 센다. 열려야 하는 자리가 생기면 그 자리가 runAsCrmViewer 로 연다.
 *
 * **없는 것과 못 보는 것은 같은 대답이다 (S3).** 단건 조회는 거름망에 걸려 0건이 되고,
 * 서비스가 원래 하던 대로 「찾을 수 없음」을 던진다. 있는지 없는지를 응답으로 알리지 않는다.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { CrmError } from './errors.ts'
import { CONTRACT_MSG } from '../../terms/contract-doc.ts'

export const CONTRACT_SENSITIVITIES = ['SALES', 'PURCHASE', 'CORPORATE'] as const
export type ContractSensitivity = (typeof CONTRACT_SENSITIVITIES)[number]

/** 등급 → 볼 수 있는 역할. 「매입은 구매 담당만」이 되면 여기 한 줄을 고친다 */
export const CONTRACT_SENSITIVITY_ROLES: Readonly<Record<ContractSensitivity, readonly string[]>> = {
  SALES: ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'],
  PURCHASE: ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'],
  CORPORATE: ['OWNER', 'ADMIN'],
}

/** 계약 방향 → 기본 등급. 회사 단위(CORPORATE)만 관리자 등급이 된다 */
export function sensitivityOfDirection(direction: string): ContractSensitivity {
  if (direction === 'CORPORATE') return 'CORPORATE'
  if (direction === 'PURCHASE') return 'PURCHASE'
  return 'SALES'
}

/** 문맥이 없으면 역할을 모르므로 일반 멤버로 센다 — 회사 단위만 닫히고 영업 매입은 잡이 계속 읽는다 */
const ROLE_WHEN_UNKNOWN = 'MEMBER'

export function visibleSensitivities(role: string | null | undefined): ContractSensitivity[] {
  const r = role ?? ROLE_WHEN_UNKNOWN
  return CONTRACT_SENSITIVITIES.filter((s) => CONTRACT_SENSITIVITY_ROLES[s].includes(r))
}

// ------------------------------------------------------------
// 문맥 — 사람 확인을 마친 창구가 연다
// ------------------------------------------------------------

const viewerStore = new AsyncLocalStorage<{ role: string }>()

/** withCrmApi 와 공개 API 다리가 역할을 확인한 뒤 연다 */
export function runAsCrmViewer<T>(role: string, fn: () => T): T {
  return viewerStore.run({ role }, fn)
}

export function currentCrmViewerRole(): string | null {
  return viewerStore.getStore()?.role ?? null
}

// ------------------------------------------------------------
// 거름망 — getCrmDb 확장이 CrmContract 연산마다 부른다
// ------------------------------------------------------------

const CONTRACT_MODEL = 'CrmContract'

const WHERE_OPS = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'update', 'updateMany', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy',
])

type Args = Record<string, unknown>

function narrowWhere(where: unknown, visible: readonly ContractSensitivity[]): Args {
  const w: Args = where && typeof where === 'object' ? { ...(where as Args) } : {}
  const gate = { sensitivity: { in: [...visible] } }
  // 호출부가 등급을 적었으면 덮지 않고 AND 로 겹친다 — 덮으면 CORPORATE 를 적은 호출이 열린다
  if ('sensitivity' in w) return { AND: [w, gate] }
  return { ...w, ...gate }
}

function assertCreatable(data: unknown, visible: readonly ContractSensitivity[]): void {
  const rows = Array.isArray(data) ? data : [data]
  for (const r of rows) {
    const s = (r && typeof r === 'object' ? (r as Args).sensitivity : undefined) ?? 'SALES'
    if (!visible.includes(s as ContractSensitivity)) {
      throw new CrmError('FORBIDDEN', CONTRACT_MSG.sensitivityDenied)
    }
  }
}

/**
 * CrmContract 연산 args 에 등급 조건을 넣은 **새 객체**를 돌려준다. 다른 모델은 그대로.
 * 만들기는 볼 수 없는 등급으로 못 만든다 — 만들고 못 보는 계약이 생기지 않게.
 */
export function guardContractSensitivity(model: string | undefined, operation: string, args: unknown, role: string | null): unknown {
  if (model !== CONTRACT_MODEL) return args
  const visible = visibleSensitivities(role)
  if (visible.length === CONTRACT_SENSITIVITIES.length) return args
  const a: Args = args && typeof args === 'object' ? { ...(args as Args) } : {}
  if (WHERE_OPS.has(operation)) return { ...a, where: narrowWhere(a.where, visible) }
  if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
    assertCreatable(a.data, visible)
    return a
  }
  if (operation === 'upsert') {
    assertCreatable(a.create, visible)
    return { ...a, where: narrowWhere(a.where, visible) }
  }
  return a
}
