'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import DynamicTable, { type ColumnDef } from '@/components/ui/DynamicTable'
import DynamicKeyValue from '@/components/ui/DynamicKeyValue'

type Toast = { msg: string; ok: boolean }

// ─── 스타일 ───────────────────────────────────────────────────────────────

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
const CARD_BODY: React.CSSProperties = { padding: '1.25rem 1.5rem' }
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

// ─── 컬럼 정의 ───────────────────────────────────────────────────────────

const PROJECT_COLS: ColumnDef[] = [
  { key: 'name', label: '프로젝트명', placeholder: '프로젝트명', width: '180px' },
  { key: 'client', label: '고객사', placeholder: '고객사' },
  { key: 'phase', label: '단계', placeholder: '기획/개발/운영', width: '100px' },
  { key: 'pm', label: 'PM', placeholder: 'PM', width: '80px' },
  { key: 'progress', label: '진행률', type: 'number', placeholder: '0', width: '80px' },
  { key: 'target', label: '목표일', placeholder: 'YYYY-MM', width: '100px' },
]

const MEMBER_COLS: ColumnDef[] = [
  { key: 'name', label: '이름', placeholder: '이름', width: '80px' },
  { key: 'role', label: '역할', placeholder: '역할', width: '100px' },
  { key: 'title', label: '직급', placeholder: '직급', width: '80px' },
  { key: 'pms', label: 'PM 프로젝트', type: 'tags', placeholder: '쉼표로 구분' },
  { key: 'extras', label: '추가 역할', type: 'tags', placeholder: '쉼표로 구분' },
]

const MISSION_COLS: ColumnDef[] = [
  { key: 'title', label: '미션 제목', placeholder: '미션 제목', width: '200px' },
  { key: 'desc', label: '설명', type: 'textarea', placeholder: '미션 설명' },
]

const OKR_COLS: ColumnDef[] = [
  { key: 'objective', label: 'Objective', placeholder: '목표', width: '200px' },
  { key: 'lead', label: 'Lead', placeholder: '담당자', width: '80px' },
  { key: 'key_results', label: 'Key Results', type: 'tags', placeholder: 'KR1, KR2, KR3' },
]

const PRINCIPLE_COLS: ColumnDef[] = [
  { key: 'title', label: '원칙 제목', placeholder: '원칙', width: '160px' },
  { key: 'desc', label: '설명', type: 'textarea', placeholder: '원칙 설명' },
]

const KPI_TARGET_COLS: ColumnDef[] = [
  { key: 'label', label: 'KPI 항목', placeholder: 'KPI 이름', width: '200px' },
  { key: 'target', label: '목표값', placeholder: '100', width: '100px' },
  { key: 'unit', label: '단위', placeholder: '개/억/점', width: '80px' },
]

const ROUTINE_COLS: ColumnDef[] = [
  { key: 'name', label: '멤버 이름', placeholder: '김도현 본부장', width: '140px' },
  { key: 'items', label: '루틴 항목', type: 'tags', placeholder: '항목1, 항목2, 항목3' },
]

// ─── 타입 ────────────────────────────────────────────────────────────────

interface MetaValue {
  org?: string
  title?: string
  subtitle?: string
  version?: string
  date?: string
}

interface ContentSectionsProps {
  data: Record<string, unknown>
  actions: {
    updateMeta: (fd: FormData) => Promise<void>
    updateProjects: (fd: FormData) => Promise<void>
    updateMembers: (fd: FormData) => Promise<void>
    updateMissions: (fd: FormData) => Promise<void>
    updateOkr: (fd: FormData) => Promise<void>
    updatePrinciples: (fd: FormData) => Promise<void>
    updateKpiTargets: (fd: FormData) => Promise<void>
    updateRhythm: (fd: FormData) => Promise<void>
    updateRoutineTemplates: (fd: FormData) => Promise<void>
    updateDevSplit: (fd: FormData) => Promise<void>
  }
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

function ensureArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
}

function SectionCard({
  title,
  badge,
  badgeColor,
  badgeText,
  children,
}: {
  title: string
  badge: string
  badgeColor: string
  badgeText: string
  children: React.ReactNode
}) {
  return (
    <section style={CARD}>
      <div style={CARD_HEADER}>
        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{title}</span>
        <span
          className="badge"
          style={{ marginLeft: 'auto', fontSize: '0.7rem', background: badgeColor, color: badgeText }}
        >
          {badge}
        </span>
      </div>
      <div style={CARD_BODY}>{children}</div>
    </section>
  )
}

// ─── 메인 ────────────────────────────────────────────────────────────────

export default function ContentSections({ data, actions }: ContentSectionsProps) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((ok: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ msg: ok ? '저장되었습니다' : '저장 실패', ok })
    timerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])


  const submit = useCallback(
    (action: (fd: FormData) => Promise<void>) =>
      async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        try {
          await action(new FormData(e.currentTarget))
          showToast(true)
        } catch {
          showToast(false)
        }
      },
    [showToast]
  )

  const meta = (data['META'] ?? {}) as MetaValue
  const projects = ensureArray(data['projects'])
  const members = ensureArray(data['members'])
  const missions = ensureArray(data['missions'])
  const okr = ensureArray(data['okr'])
  const principles = ensureArray(data['principles'])
  const kpiTargets = ensureArray(data['kpi_targets'])
  const routineTemplates = ensureArray(data['routine_templates'])
  const rhythm = (data['rhythm'] ?? {}) as Record<string, unknown>
  const devSplit = (data['dev_split'] ?? {}) as Record<string, unknown>

  return (
    <>
      {toast && (
        <div role="alert" aria-live="polite" style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
          padding: '0.75rem 1.25rem',
          background: toast.ok ? '#16a34a' : '#dc2626',
          color: '#fff', borderRadius: '0.5rem',
          fontSize: '0.875rem', fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
        }}>
          {toast.ok ? '✓ ' : '✕ '}{toast.msg}
        </div>
      )}

      {/* 1. META */}
      <SectionCard title="본부 기본 정보" badge="META" badgeColor="#ede9fe" badgeText="#7c3aed">
        <form onSubmit={submit(actions.updateMeta)}>
          <div style={FIELD_GRID}>
            {(
              [
                { key: 'org',      label: '조직명 (DOCX 조직 컬럼 표시)' },
                { key: 'title',    label: '본부 이름' },
                { key: 'subtitle', label: '부제' },
                { key: 'version',  label: '버전' },
                { key: 'date',     label: '기준일' },
              ] as { key: keyof MetaValue; label: string }[]
            ).map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={`meta_${key}`} style={LABEL}>{label}</label>
                <input id={`meta_${key}`} name={key} defaultValue={String(meta[key] ?? '')} style={INPUT} />
              </div>
            ))}
          </div>
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 2. projects */}
      <SectionCard title="프로젝트" badge="projects" badgeColor="#dbeafe" badgeText="#1d4ed8">
        <form onSubmit={submit(actions.updateProjects)}>
          <DynamicTable name="projects_json" columns={PROJECT_COLS} initialData={projects} addLabel="프로젝트 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 3. members */}
      <SectionCard title="멤버" badge="members" badgeColor="#dcfce7" badgeText="#15803d">
        <form onSubmit={submit(actions.updateMembers)}>
          <DynamicTable name="members_json" columns={MEMBER_COLS} initialData={members} addLabel="멤버 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 4. missions */}
      <SectionCard title="미션" badge="missions" badgeColor="#fef9c3" badgeText="#a16207">
        <form onSubmit={submit(actions.updateMissions)}>
          <DynamicTable name="missions_json" columns={MISSION_COLS} initialData={missions} addLabel="미션 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 5. okr */}
      <SectionCard title="OKR" badge="okr" badgeColor="#fee2e2" badgeText="#dc2626">
        <form onSubmit={submit(actions.updateOkr)}>
          <DynamicTable name="okr_json" columns={OKR_COLS} initialData={okr} addLabel="OKR 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 6. principles */}
      <SectionCard title="원칙" badge="principles" badgeColor="#f3e8ff" badgeText="#7c3aed">
        <form onSubmit={submit(actions.updatePrinciples)}>
          <DynamicTable name="principles_json" columns={PRINCIPLE_COLS} initialData={principles} addLabel="원칙 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 7. kpi_targets */}
      <SectionCard title="KPI 목표" badge="kpi_targets" badgeColor="#dbeafe" badgeText="#1d4ed8">
        <form onSubmit={submit(actions.updateKpiTargets)}>
          <DynamicTable name="kpi_targets_json" columns={KPI_TARGET_COLS} initialData={kpiTargets} addLabel="KPI 목표 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 8. routine_templates */}
      <SectionCard title="루틴 템플릿" badge="routine_templates" badgeColor="#fef3c7" badgeText="#b45309">
        <form onSubmit={submit(actions.updateRoutineTemplates)}>
          <DynamicTable name="routine_templates_json" columns={ROUTINE_COLS} initialData={routineTemplates} addLabel="루틴 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 9. rhythm */}
      <SectionCard title="리듬 (Rhythm)" badge="rhythm" badgeColor="#f0fdf4" badgeText="#15803d">
        <form onSubmit={submit(actions.updateRhythm)}>
          <DynamicKeyValue name="rhythm_json" initialData={rhythm} addLabel="리듬 항목 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>

      {/* 10. dev_split */}
      <SectionCard title="개발 분배" badge="dev_split" badgeColor="#ede9fe" badgeText="#7c3aed">
        <form onSubmit={submit(actions.updateDevSplit)}>
          <DynamicKeyValue name="dev_split_json" initialData={devSplit} addLabel="항목 추가" />
          <button type="submit" style={SUBMIT}>저장</button>
        </form>
      </SectionCard>
    </>
  )
}
