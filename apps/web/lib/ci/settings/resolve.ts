// lib/ci/settings/resolve.ts — 3계층 스코프 해석 SSOT
// 설계서 §10.1: "하위 스코프가 상위를 덮어쓰고 해석 순서는 개인, 워크스페이스, 시스템, 코드 기본값"
//
// 순수 함수로 유지한다. DB 조회는 호출자가 하고, 여기서는 병합만 한다.
// 매 요청 DB 조회 금지 — 룰셋을 한 번 올려두고 이 함수로 로컬 평가한다.

import type { CiSettingScope } from '../types.ts'
import { codeDefaults, getSettingDef } from './registry.ts'
import { isSecretEnvelope, decryptSecret, type SecretEnvelope } from './crypto.ts'

export interface SettingRow {
  scope: CiSettingScope
  scope_id: string | null
  key: string
  value: unknown
  is_encrypted: boolean
  version: number
}

export interface ResolveContext {
  userId: string | null
  workspaceId: string | null
}

/** 해석 우선순위 — 숫자가 클수록 우선한다. */
const PRIORITY: Record<CiSettingScope, number> = { system: 1, workspace: 2, user: 3 }

/**
 * 스코프 규칙에 맞는 행만 남긴다.
 * 다른 사용자·다른 워크스페이스 행이 섞여 들어와도 여기서 걸러진다(방어적).
 */
export function selectApplicable(rows: readonly SettingRow[], ctx: ResolveContext): SettingRow[] {
  return rows.filter((r) => {
    if (r.scope === 'system') return r.scope_id === null
    if (r.scope === 'workspace') return ctx.workspaceId !== null && r.scope_id === ctx.workspaceId
    if (r.scope === 'user') return ctx.userId !== null && r.scope_id === ctx.userId
    return false
  })
}

/**
 * 최종 설정값 맵을 만든다. 코드 기본값에서 시작해 system → workspace → user 순으로 덮어쓴다.
 * 암호화 값은 복호하지 않는다(needsDecryption=true일 때만 복호).
 */
export function resolveSettings(
  rows: readonly SettingRow[],
  ctx: ResolveContext,
  options: { decryptSecrets?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...codeDefaults() }

  const applicable = selectApplicable(rows, ctx)
    .slice()
    .sort((a, b) => PRIORITY[a.scope] - PRIORITY[b.scope])

  for (const row of applicable) {
    // 미등록 키는 무시한다 — 레지스트리에서 제거된 설정이 유령으로 남지 않게.
    if (!getSettingDef(row.key)) continue

    if (row.is_encrypted && isSecretEnvelope(row.value)) {
      if (options.decryptSecrets) {
        try {
          out[row.key] = decryptSecret(row.value as SecretEnvelope)
        } catch {
          // 복호 실패는 값을 남기지 않는다. 잘못된 값으로 동작하느니 기본값을 쓴다.
          continue
        }
      }
      // decryptSecrets가 아니면 시크릿은 결과에 넣지 않는다(유출 방지).
      continue
    }
    out[row.key] = row.value
  }

  return out
}

/** 단건 조회 — 해석 결과에서 타입을 좁혀 꺼낸다. */
export function getResolved<T>(resolved: Record<string, unknown>, key: string): T | undefined {
  const d = getSettingDef(key)
  if (!d) return undefined
  const raw = resolved[key]
  const parsed = d.schema.safeParse(raw)
  return parsed.success ? (parsed.data as T) : (d.defaultValue as T)
}

/**
 * 어떤 스코프에서 값이 왔는지 — 설정 UI에서 "워크스페이스 기본값 상속 중"을 표시하기 위함.
 */
export function resolveOrigin(
  rows: readonly SettingRow[],
  ctx: ResolveContext,
  key: string,
): CiSettingScope | 'default' {
  const applicable = selectApplicable(rows, ctx)
    .filter((r) => r.key === key)
    .sort((a, b) => PRIORITY[b.scope] - PRIORITY[a.scope])
  return applicable[0]?.scope ?? 'default'
}
