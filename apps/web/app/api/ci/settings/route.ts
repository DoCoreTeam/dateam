import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { requireCiMemberApi, workspaceIdFromRequest } from '@/lib/ci/auth/requireCiMember'
import { listSettingDefs, validateSetting, getSettingDef } from '@/lib/ci/settings/registry'
import { resolveSettings, resolveOrigin, type SettingRow } from '@/lib/ci/settings/resolve'
import { encryptSecret, isMasterKeyAvailable, maskIfSecret } from '@/lib/ci/settings/crypto'
import type { CiSettingScope } from '@/lib/ci/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const Put = z.object({
  key: z.string().min(1),
  scope: z.enum(['system', 'workspace', 'user']),
  value: z.unknown(),
  version: z.number().int().optional(),
})

async function loadRows(workspaceId: string, userId: string): Promise<SettingRow[]> {
  const adminClient = createAdminClient() as any
  const { data } = await adminClient
    .from('ci_settings')
    .select('scope, scope_id, key, value, is_encrypted, version')
    .or(`and(scope.eq.system,scope_id.is.null),and(scope.eq.workspace,scope_id.eq.${workspaceId}),and(scope.eq.user,scope_id.eq.${userId})`)
  return (data ?? []) as SettingRow[]
}

/** 설정 화면이 쓰는 모든 것: 정의(폼 자동 생성) + 현재값 + 출처 스코프. */
export async function GET(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId)
    if (error) return error

    const rows = await loadRows(session.workspaceId, session.userId)
    const ctx = { userId: session.userId, workspaceId: session.workspaceId }
    const resolved = resolveSettings(rows, ctx)

    const items = listSettingDefs().map((d) => ({
      key: d.key,
      scope: d.scope,
      group: d.group,
      label: d.label,
      help: d.help,
      value: maskIfSecret(resolved[d.key], Boolean(d.isSecret)),
      defaultValue: d.defaultValue,
      origin: resolveOrigin(rows, ctx, d.key),
      isSecret: Boolean(d.isSecret),
      destructive: Boolean(d.destructive),
      version: rows.find((r) => r.key === d.key && r.scope === d.scope)?.version ?? 0,
      // 설정 UI가 입력 위젯을 고르는 힌트. 스키마에서 화면을 만들기 위한 최소 정보.
      kind: typeof d.defaultValue === 'boolean' ? 'boolean'
        : typeof d.defaultValue === 'number' ? 'number'
        : Array.isArray(d.defaultValue) ? 'list'
        : typeof d.defaultValue === 'object' ? 'json' : 'text',
    }))

    return ok({ items, encryptionAvailable: isMasterKeyAvailable() })
  } catch (e) {
    return failUnexpected(e)
  }
}

export async function PUT(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const parsed = Put.safeParse(await req.json())
    if (!parsed.success) return fail('VALIDATION_FAILED', '입력값을 확인해 주세요', parsed.error.issues)

    const { key, scope, value, version } = parsed.data
    const def = getSettingDef(key)
    if (!def) return fail('VALIDATION_FAILED', `등록되지 않은 설정 키입니다: ${key}`)

    // 워크스페이스·시스템 설정은 권한이 더 필요하다
    if (scope === 'workspace' && session.role !== 'owner' && session.role !== 'admin') {
      return fail('FORBIDDEN', '워크스페이스 설정은 관리자만 바꿀 수 있습니다')
    }
    if (scope === 'system') {
      return fail('FORBIDDEN', '시스템 설정은 운영자 콘솔에서만 바꿀 수 있습니다')
    }

    const verdict = validateSetting(key, scope as CiSettingScope, value)
    if (!verdict.ok) return fail('VALIDATION_FAILED', verdict.message, verdict.details)

    // 시크릿은 마스터 키가 없으면 저장을 거부한다 — 평문 폴백 금지
    let stored: unknown = verdict.value
    if (def.isSecret) {
      if (!isMasterKeyAvailable()) {
        return fail('SETTING_ENCRYPTION_UNAVAILABLE',
          '암호화 키가 설정되지 않아 이 값을 저장할 수 없습니다')
      }
      stored = encryptSecret(String(verdict.value))
    }

    const scopeId = scope === 'user' ? session.userId : session.workspaceId
    const adminClient = createAdminClient() as any

    const { data: existing } = await adminClient.from('ci_settings')
      .select('id, version').eq('scope', scope).eq('scope_id', scopeId).eq('key', key).maybeSingle()

    if (existing) {
      // 낙관적 잠금 — 다른 사람이 먼저 바꿨으면 덮어쓰지 않는다
      if (version !== undefined && existing.version !== version) {
        return fail('CONFLICT', '다른 곳에서 먼저 변경되었습니다. 새로고침 후 다시 시도해 주세요')
      }
      await adminClient.from('ci_settings')
        .update({ value: stored, is_encrypted: Boolean(def.isSecret), updated_by: session.userId })
        .eq('id', existing.id)
    } else {
      await adminClient.from('ci_settings').insert({
        scope, scope_id: scopeId, key, value: stored,
        is_encrypted: Boolean(def.isSecret), updated_by: session.userId,
      })
    }

    return ok({ key, value: maskIfSecret(verdict.value, Boolean(def.isSecret)) })
  } catch (e) {
    return failUnexpected(e)
  }
}

/** 상위 스코프로 되돌리기. */
export async function DELETE(req: Request) {
  try {
    const workspaceId = workspaceIdFromRequest(req)
    const { session, error } = await requireCiMemberApi(workspaceId, 'member')
    if (error) return error

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    const scope = url.searchParams.get('scope') as CiSettingScope | null
    if (!key || !scope) return fail('VALIDATION_FAILED', 'key와 scope가 필요합니다')
    if (scope === 'system') return fail('FORBIDDEN', '시스템 설정은 여기서 되돌릴 수 없습니다')

    const scopeId = scope === 'user' ? session.userId : session.workspaceId
    const adminClient = createAdminClient() as any
    await adminClient.from('ci_settings').delete()
      .eq('scope', scope).eq('scope_id', scopeId).eq('key', key)

    return ok({ key, reverted: true })
  } catch (e) {
    return failUnexpected(e)
  }
}
