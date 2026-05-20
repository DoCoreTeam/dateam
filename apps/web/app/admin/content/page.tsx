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

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface MetaValue {
  org?: string
  title?: string
  subtitle?: string
  version?: string
  date?: string
}

interface ProjectRow {
  name?: string
  client?: string
  phase?: string
  pm?: string
  progress?: number | string
  target?: string
}

interface MissionRow {
  title?: string
  desc?: string
}

interface OkrRow {
  objective?: string
  lead?: string
  key_results?: string[]
}

interface PrincipleRow {
  title?: string
  desc?: string
}

interface KpiTargetRow {
  label?: string
  target?: string | number
}

// ─── 공통 스타일 ──────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '0.75rem',
  overflow: 'hidden',
  marginBottom: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
}

const CARD_HEADER: React.CSSProperties = {
  padding: '1rem 1.5rem',
  borderBottom: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  background: '#f8fafc',
}

const CARD_BODY: React.CSSProperties = {
  padding: '1.25rem 1.5rem',
}

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#64748b',
  marginBottom: '0.3rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #e2e8f0',
  borderRadius: '0.4rem',
  fontSize: '0.875rem',
  color: '#0f172a',
  background: '#fff',
  boxSizing: 'border-box',
}

const TEXTAREA: React.CSSProperties = {
  ...INPUT,
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.8125rem',
  resize: 'vertical',
  minHeight: '180px',
  lineHeight: 1.6,
}

const SUBMIT: React.CSSProperties = {
  marginTop: '1rem',
  padding: '0.5rem 1.25rem',
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '0.4rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const FIELD_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '1rem',
}

const TH: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#64748b',
  background: '#f8fafc',
  textAlign: 'left',
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  verticalAlign: 'middle',
}

// ─── 페이지 ───────────────────────────────────────────────────────────────

export default async function AdminContentPage() {
  const adminClient = createAdminClient()
  const keys = [
    'META',
    'projects',
    'members',
    'missions',
    'okr',
    'principles',
    'rhythm',
    'kpi_targets',
    'routine_templates',
    'dev_split',
  ]

  const rows = await Promise.all(
    keys.map((k) =>
      adminClient.from('org_content').select('key, value').eq('key', k).single()
    )
  )

  const byKey = Object.fromEntries(
    rows.map((r, i) => [keys[i], (r.data as { key: string; value: unknown } | null)?.value ?? null])
  )

  const meta = (byKey['META'] ?? {}) as MetaValue
  const projects = (byKey['projects'] ?? []) as ProjectRow[]
  const members = byKey['members']
  const missions = (byKey['missions'] ?? []) as MissionRow[]
  const okr = (byKey['okr'] ?? []) as OkrRow[]
  const principles = (byKey['principles'] ?? []) as PrincipleRow[]
  const kpiTargets = (byKey['kpi_targets'] ?? []) as KpiTargetRow[]
  const rhythm = byKey['rhythm']
  const routineTemplates = byKey['routine_templates']
  const devSplit = byKey['dev_split']

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* 헤더 */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
          <Settings2 size={20} color="#6366f1" />
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#0f172a',
              letterSpacing: '-0.03em',
              margin: 0,
            }}
          >
            콘텐츠 관리
          </h1>
        </div>
        <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
          dashboard.html에서 마이그레이션된 본부 콘텐츠를 관리합니다.
        </p>
      </div>

      {/* 1. META */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>본부 기본 정보</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#ede9fe', color: '#7c3aed' }}>META</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateMeta}>
            <div style={FIELD_GRID}>
              {(['org', 'title', 'subtitle', 'version', 'date'] as const).map((field) => (
                <div key={field}>
                  <label htmlFor={`meta_${field}`} style={LABEL}>{field}</label>
                  <input
                    id={`meta_${field}`}
                    name={field}
                    defaultValue={String(meta[field] ?? '')}
                    style={INPUT}
                  />
                </div>
              ))}
            </div>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 2. projects */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>프로젝트</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8' }}>projects</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateProjects}>
            <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                <thead>
                  <tr>
                    {['name', 'client', 'phase', 'pm', 'progress', 'target'].map((col) => (
                      <th key={col} style={TH}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody id="projects-table-body">
                  {(Array.isArray(projects) ? projects : []).map((p, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      {(['name', 'client', 'phase', 'pm', 'progress', 'target'] as const).map((col) => (
                        <td key={col} style={TD}>
                          <input
                            name={`project_${i}_${col}`}
                            defaultValue={String(p[col] ?? '')}
                            style={{ ...INPUT, minWidth: '90px' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 테이블 데이터를 JSON으로 직렬화해서 제출 — hidden field로 projects 전체 전달 */}
            <input
              type="hidden"
              name="projects_json"
              value={JSON.stringify(projects)}
            />
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0' }}>
              * 행 편집 후 저장합니다. 행 추가·삭제는 아래 JSON 영역을 직접 수정하세요.
            </p>
            <details style={{ marginBottom: '0.5rem' }}>
              <summary style={{ fontSize: '0.8125rem', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}>
                JSON 직접 편집
              </summary>
              <textarea
                name="projects_json"
                defaultValue={JSON.stringify(projects, null, 2)}
                style={{ ...TEXTAREA, marginTop: '0.5rem' }}
              />
            </details>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 3. members */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>멤버</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#dcfce7', color: '#15803d' }}>members</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateMembers}>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0 }}>
              JSON 배열로 편집합니다. <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: '3px' }}>{'[{"name":"...", "role":"..."}]'}</code>
            </p>
            <textarea
              name="members_json"
              defaultValue={JSON.stringify(members, null, 2)}
              style={TEXTAREA}
            />
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 4. missions */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>미션</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#fef9c3', color: '#a16207' }}>missions</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateMissions}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {(Array.isArray(missions) ? missions : []).map((m, i) => (
                <div
                  key={i}
                  style={{
                    padding: '1rem',
                    background: '#f8fafc',
                    borderRadius: '0.5rem',
                    border: '1px solid #e2e8f0',
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <label style={LABEL}>title</label>
                    <input
                      name={`mission_${i}_title`}
                      defaultValue={m.title ?? ''}
                      style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>desc</label>
                    <input
                      name={`mission_${i}_desc`}
                      defaultValue={m.desc ?? ''}
                      style={INPUT}
                    />
                  </div>
                </div>
              ))}
            </div>
            <input type="hidden" name="missions_json" value={JSON.stringify(missions)} />
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ fontSize: '0.8125rem', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}>
                JSON 직접 편집
              </summary>
              <textarea
                name="missions_json"
                defaultValue={JSON.stringify(missions, null, 2)}
                style={{ ...TEXTAREA, marginTop: '0.5rem' }}
              />
            </details>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 5. okr */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>OKR</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#fee2e2', color: '#dc2626' }}>okr</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateOkr}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {(Array.isArray(okr) ? okr : []).map((o, i) => (
                <div
                  key={i}
                  style={{
                    padding: '1rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={LABEL}>objective</label>
                      <input
                        name={`okr_${i}_objective`}
                        defaultValue={o.objective ?? ''}
                        style={INPUT}
                      />
                    </div>
                    <div>
                      <label style={LABEL}>lead</label>
                      <input
                        name={`okr_${i}_lead`}
                        defaultValue={o.lead ?? ''}
                        style={INPUT}
                      />
                    </div>
                  </div>
                  <label style={LABEL}>key results</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {[0, 1, 2].map((kr) => (
                      <input
                        key={kr}
                        name={`okr_${i}_kr_${kr}`}
                        defaultValue={o.key_results?.[kr] ?? ''}
                        placeholder={`KR ${kr + 1}`}
                        style={INPUT}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <input type="hidden" name="okr_json" value={JSON.stringify(okr)} />
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ fontSize: '0.8125rem', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}>
                JSON 직접 편집
              </summary>
              <textarea
                name="okr_json"
                defaultValue={JSON.stringify(okr, null, 2)}
                style={{ ...TEXTAREA, marginTop: '0.5rem' }}
              />
            </details>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 6. principles */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>원칙</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#f3e8ff', color: '#7c3aed' }}>principles</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updatePrinciples}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(Array.isArray(principles) ? principles : []).map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 2fr',
                    gap: '0.75rem',
                    padding: '0.875rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.5rem',
                  }}
                >
                  <div>
                    <label style={LABEL}>title</label>
                    <input
                      name={`principle_${i}_title`}
                      defaultValue={p.title ?? ''}
                      style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>desc</label>
                    <input
                      name={`principle_${i}_desc`}
                      defaultValue={p.desc ?? ''}
                      style={INPUT}
                    />
                  </div>
                </div>
              ))}
            </div>
            <input type="hidden" name="principles_json" value={JSON.stringify(principles)} />
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ fontSize: '0.8125rem', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}>
                JSON 직접 편집
              </summary>
              <textarea
                name="principles_json"
                defaultValue={JSON.stringify(principles, null, 2)}
                style={{ ...TEXTAREA, marginTop: '0.5rem' }}
              />
            </details>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 7. kpi_targets */}
      <section style={CARD}>
        <div style={CARD_HEADER}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>KPI 목표</span>
          <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8' }}>kpi_targets</span>
        </div>
        <div style={CARD_BODY}>
          <form action={updateKpiTargets}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {(Array.isArray(kpiTargets) ? kpiTargets : []).map((k, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={LABEL}>label</label>
                    <input
                      name={`kpi_${i}_label`}
                      defaultValue={String(k.label ?? '')}
                      style={INPUT}
                    />
                  </div>
                  <div>
                    <label style={LABEL}>target</label>
                    <input
                      name={`kpi_${i}_target`}
                      defaultValue={String(k.target ?? '')}
                      style={INPUT}
                    />
                  </div>
                </div>
              ))}
            </div>
            <input type="hidden" name="kpi_targets_json" value={JSON.stringify(kpiTargets)} />
            <details>
              <summary style={{ fontSize: '0.8125rem', color: '#6366f1', cursor: 'pointer', userSelect: 'none' }}>
                JSON 직접 편집
              </summary>
              <textarea
                name="kpi_targets_json"
                defaultValue={JSON.stringify(kpiTargets, null, 2)}
                style={{ ...TEXTAREA, marginTop: '0.5rem' }}
              />
            </details>
            <button type="submit" style={SUBMIT}>저장</button>
          </form>
        </div>
      </section>

      {/* 8. rhythm */}
      <JsonSection
        title="리듬 (Rhythm)"
        badge="rhythm"
        badgeStyle={{ background: '#f0fdf4', color: '#15803d' }}
        action={updateRhythm}
        fieldName="rhythm_json"
        value={rhythm}
      />

      {/* 9. routine_templates */}
      <JsonSection
        title="루틴 템플릿"
        badge="routine_templates"
        badgeStyle={{ background: '#fef3c7', color: '#b45309' }}
        action={updateRoutineTemplates}
        fieldName="routine_templates_json"
        value={routineTemplates}
      />

      {/* 10. dev_split */}
      <JsonSection
        title="개발 분배"
        badge="dev_split"
        badgeStyle={{ background: '#ede9fe', color: '#7c3aed' }}
        action={updateDevSplit}
        fieldName="dev_split_json"
        value={devSplit}
      />
    </div>
  )
}

// ─── JSON 편집 공용 섹션 컴포넌트 ────────────────────────────────────────

function JsonSection({
  title,
  badge,
  badgeStyle,
  action,
  fieldName,
  value,
}: {
  title: string
  badge: string
  badgeStyle: React.CSSProperties
  action: (formData: FormData) => Promise<void>
  fieldName: string
  value: unknown
}) {
  return (
    <section style={CARD}>
      <div style={CARD_HEADER}>
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{title}</span>
        <span
          className="badge"
          style={{ marginLeft: 'auto', fontSize: '0.7rem', ...badgeStyle }}
        >
          {badge}
        </span>
      </div>
      <div style={CARD_BODY}>
        <form action={action}>
          <textarea
            name={fieldName}
            defaultValue={JSON.stringify(value, null, 2)}
            style={TEXTAREA}
          />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </div>
    </section>
  )
}
