'use server'

// 목록 심층분석 v2 — 출력 템플릿 CRUD + LLM 생성 서버액션(requireAdminApi 게이트, RLS admin+owner).
// 큐레이션 6종은 코드 SSOT(templates/catalog.ts) — 여기선 DB의 커스텀/LLM 템플릿만 다룬다.
// resolve/generate는 순수모듈 재사용(templates/resolve.ts, templates/generate.ts).

import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getProviderConfig, getProvider } from '@/lib/ai-chat/registry'
import { logTokenUsage } from '@/lib/token-logger'
import { logDbError } from '@/lib/ai-chat/log-db-error'
import { buildTemplateGenPrompt, parseTemplateSpec } from '@/lib/ai-chat/templates/generate'
import type { FieldSpec, AssemblySpec } from '@/lib/ai-chat/templates/catalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export interface TemplateRow {
  id: string
  name: string
  description: string
  fields: FieldSpec[]
  assembly: AssemblySpec
  origin: 'llm' | 'custom'
}
export type TemplateResult<T> = { ok: true; data: T } | { ok: false; error: string }

const MAX_NAME = 80

function rowToTemplate(r: Record<string, unknown>): TemplateRow {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    fields: (r.fields as FieldSpec[]) ?? [],
    assembly: (r.assembly as AssemblySpec) ?? { mode: 'sections', itemNoun: '항목' },
    origin: (r.origin as 'llm' | 'custom') ?? 'custom',
  }
}

/** 내 커스텀·LLM 템플릿 목록(소프트삭제 제외, 최근순). 큐레이션 6종은 클라가 catalog에서 합친다. */
export async function listTemplates(): Promise<TemplateResult<TemplateRow[]>> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient
  const { data, error } = await admin
    .from('ai_analysis_templates')
    .select('id, name, description, fields, assembly, origin')
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (error) {
    logDbError('listTemplates:select', error)
    return { ok: false, error: '템플릿 목록을 불러오지 못했습니다' }
  }
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(rowToTemplate) }
}

function validateInput(input: { name?: string; fields?: unknown; assembly?: unknown }): string | null {
  if (!input.name || !input.name.trim()) return '템플릿 이름이 필요합니다'
  if (input.name.length > MAX_NAME) return '템플릿 이름이 너무 깁니다'
  if (!Array.isArray(input.fields) || input.fields.length === 0) return '필드가 최소 1개 필요합니다'
  return null
}

/** 커스텀 템플릿 생성. */
export async function createTemplate(input: {
  name: string
  description?: string
  fields: FieldSpec[]
  assembly: AssemblySpec
}): Promise<TemplateResult<TemplateRow>> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const invalid = validateInput(input)
  if (invalid) return { ok: false, error: invalid }
  const admin = createAdminClient() as AdminClient
  const { data, error } = await admin
    .from('ai_analysis_templates')
    .insert({
      user_id: auth.user.id,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      fields: input.fields,
      assembly: input.assembly,
      origin: 'custom',
    })
    .select('id, name, description, fields, assembly, origin')
    .single()
  if (error || !data) {
    if (error) logDbError('createTemplate:insert', error)
    return { ok: false, error: '템플릿 저장 중 오류가 발생했습니다' }
  }
  return { ok: true, data: rowToTemplate(data as Record<string, unknown>) }
}

/** 템플릿 수정(owner RLS로 타인 것 차단). */
export async function updateTemplate(
  id: string,
  patch: { name?: string; description?: string; fields?: FieldSpec[]; assembly?: AssemblySpec },
): Promise<TemplateResult<TemplateRow>> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient
  const upd: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, error: '템플릿 이름이 필요합니다' }
    upd.name = patch.name.trim()
  }
  if (patch.description !== undefined) upd.description = patch.description.trim()
  if (patch.fields !== undefined) {
    if (!Array.isArray(patch.fields) || patch.fields.length === 0) return { ok: false, error: '필드가 최소 1개 필요합니다' }
    upd.fields = patch.fields
  }
  if (patch.assembly !== undefined) upd.assembly = patch.assembly
  const { data, error } = await admin
    .from('ai_analysis_templates')
    .update(upd)
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .select('id, name, description, fields, assembly, origin')
    .single()
  if (error || !data) {
    if (error) logDbError('updateTemplate:update', error, { id })
    return { ok: false, error: '템플릿 수정 중 오류가 발생했습니다' }
  }
  return { ok: true, data: rowToTemplate(data as Record<string, unknown>) }
}

/** 소프트 삭제. */
export async function deleteTemplate(id: string): Promise<TemplateResult<{ id: string }>> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient
  const { error } = await admin
    .from('ai_analysis_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null) // 이미 삭제된 레코드의 deleted_at 재갱신 방지(타 CRUD와 동일 조건)
  if (error) {
    logDbError('deleteTemplate:update', error, { id })
    return { ok: false, error: '템플릿 삭제 중 오류가 발생했습니다' }
  }
  return { ok: true, data: { id } }
}

/** 지시 → LLM 템플릿 스키마 생성 후 origin='llm'로 저장. resolve 미매칭 시 호출. */
export async function generateTemplate(command: string): Promise<TemplateResult<TemplateRow>> {
  const auth = await requireAdminApi()
  if (auth.error) return { ok: false, error: '권한이 없습니다' }
  const admin = createAdminClient() as AdminClient
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const cfg = getProviderConfig(meta, 'gemini')
  if (!cfg) return { ok: false, error: 'Gemini API 키가 설정되지 않았습니다' }

  let text = ''
  try {
    const provider = getProvider('gemini')
    const controller = new AbortController()
    const result = await provider.streamChat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      turns: [{ role: 'user', content: buildTemplateGenPrompt(command) }],
      signal: controller.signal,
      onDelta: (d) => {
        text += d
      },
    })
    logTokenUsage({
      userId: auth.user.id,
      feature: 'ai-chat-analyze',
      model: cfg.model,
      provider: 'gemini',
      promptTokens: result.usage.promptTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    })
  } catch (err) {
    logDbError('generateTemplate:ai', err)
    return { ok: false, error: '템플릿 자동 생성에 실패했습니다. 기본 양식으로 진행하거나 직접 만들어 주세요.' }
  }

  const spec = parseTemplateSpec(text)
  if (!spec) return { ok: false, error: '생성된 템플릿 형식이 올바르지 않습니다. 다시 시도해 주세요.' }
  return createTemplateFromSpec(admin, auth.user.id, spec)
}

async function createTemplateFromSpec(
  admin: AdminClient,
  userId: string,
  spec: { name: string; description: string; fields: FieldSpec[]; assembly: AssemblySpec },
): Promise<TemplateResult<TemplateRow>> {
  const { data, error } = await admin
    .from('ai_analysis_templates')
    .insert({ user_id: userId, name: spec.name, description: spec.description, fields: spec.fields, assembly: spec.assembly, origin: 'llm' })
    .select('id, name, description, fields, assembly, origin')
    .single()
  if (error || !data) {
    if (error) logDbError('createTemplateFromSpec:insert', error)
    return { ok: false, error: '생성된 템플릿 저장 중 오류가 발생했습니다' }
  }
  return { ok: true, data: rowToTemplate(data as Record<string, unknown>) }
}
