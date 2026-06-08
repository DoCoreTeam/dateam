import { createAdminClient } from '@/lib/supabase/server'
import { Settings2 } from 'lucide-react'
import {
  updateMeta,
  updateProjects,
  updateMembers,
  updateMissions,
  updateOkr,
  updatePrinciples,
  updateKpiTargets,
  updateRhythm,
  updateRoutineTemplates,
  updateDevSplit,
} from './actions'
import ContentSections from './ContentSections'

export default async function AdminContentPage() {
  const adminClient = createAdminClient()
  const keys = [
    'META', 'projects', 'members', 'missions', 'okr',
    'principles', 'rhythm', 'kpi_targets', 'routine_templates', 'dev_split',
  ]

  const rows = await Promise.all(
    keys.map((k) => adminClient.from('org_content').select('key, value').eq('key', k).single())
  )

  const byKey = Object.fromEntries(
    rows.map((r, i) => [keys[i], (r.data as { key: string; value: unknown } | null)?.value ?? null])
  )

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
          <Settings2 size={20} color="var(--brand)" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
            콘텐츠 관리
          </h1>
        </div>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
          본부 콘텐츠를 관리합니다. 각 섹션에서 항목을 추가·수정·삭제하고 저장하세요.
        </p>
      </div>

      <ContentSections
        data={byKey}
        actions={{
          updateMeta,
          updateProjects,
          updateMembers,
          updateMissions,
          updateOkr,
          updatePrinciples,
          updateKpiTargets,
          updateRhythm,
          updateRoutineTemplates,
          updateDevSplit,
        }}
      />
    </div>
  )
}
