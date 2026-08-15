import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Building2, Handshake, Users, Target, ListChecks } from 'lucide-react'
import WorkPageShell from '@/components/ui/WorkPageShell'
import EmptyState from '@/components/ui/EmptyState'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { PROJECT_SELECT } from '@/lib/work/project-fields'
import { budgetLabel, periodLabel, statusBadge } from '@/lib/work/project-display'
import ProjectMembersClient from './ProjectMembersClient'
import ProjectCommandClient from './ProjectCommandClient'
import ProjectOperationsClient from './ProjectOperationsClient'

interface PageProps { params: Promise<{ id: string }> }

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const user = await getRequestUser()
  const { data: project } = await db.from('projects').select(PROJECT_SELECT)
    .eq('id', id).is('deleted_at', null).maybeSingle()
  if (!project) notFound()

  const [{ data: account }, { data: deal }, { data: members }, { data: links }, { data: items }, { data: aiProject }] = await Promise.all([
    project.account_id ? db.from('accounts').select('id,name').eq('id', project.account_id).maybeSingle() : { data: null },
    project.origin_deal_id ? db.from('deals').select('id,title,stage').eq('id', project.origin_deal_id).maybeSingle() : { data: null },
    db.from('project_members').select('user_id,role,profiles(name,position)').eq('project_id', id).order('created_at'),
    db.from('work_entity_links').select('log_id').eq('kind', 'project').eq('entity_id', id).limit(100),
    db.from('project_items').select('id,kind,title,status,due_date').eq('project_id', id).is('deleted_at', null).order('created_at'),
    db.from('ai_projects').select('id,name').eq('work_project_id', id).is('deleted_at', null).maybeSingle(),
  ])
  const logIds = (links ?? []).map((row: { log_id: string }) => row.log_id)
  const { data: myProfile } = user
    ? await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
    : { data: null }
  const myMembership = (members ?? []).find((member: { user_id: string }) => member.user_id === user?.id)
  const isAdmin = myProfile?.role === 'admin'
  const canManage = project.user_id === user?.id || isAdmin || myMembership?.role === 'manager'
  const { data: profiles } = canManage
    ? await db.from('profiles').select('id,name,position').is('deleted_at', null).order('name')
    : { data: [] }
  const { data: logs } = logIds.length
    ? await db.from('daily_logs').select('id,content,entry_type,log_date').in('id', logIds)
      .is('deleted_at', null).order('log_date', { ascending: false }).limit(20)
    : { data: [] }
  const badge = statusBadge(project.status)

  return (
    <WorkPageShell title={project.name} description={project.description || '프로젝트 목표·관계·업무를 한 곳에서 확인합니다.'}>
      <Link href="/work/projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', marginBottom: 'var(--space-3)' }}>
        <ArrowLeft size={16} /> 프로젝트 목록
      </Link>

      <section className="responsive-grid-cols-4" style={{ display: 'grid', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <Summary label="상태" value={badge.label} />
        <Summary label="기간" value={periodLabel(project) ?? '미지정'} />
        <Summary label="예산" value={budgetLabel(project.budget, project.currency) ?? '미지정'} />
        <Summary label="공유" value={visibilityLabel(project.visibility)} />
      </section>

      <div className="responsive-grid-2" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Panel icon={<Target size={18} />} title="목표와 성공 기준">
            <Detail label="목표" value={project.objective} />
            <Detail label="성공 기준" value={project.success_criteria} />
          </Panel>
          <Panel icon={<ListChecks size={18} />} title={`연결된 업무 ${logs?.length ?? 0}건`}>
            {(logs ?? []).length === 0 ? <EmptyState title="아직 연결된 업무가 없어요" description="일일업무에서 이 프로젝트를 연결하면 여기에 모입니다" action={{ label: '일일업무로 이동', href: '/daily' }} /> : (
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {(logs ?? []).map((log: { id: string; content: string; log_date: string }) => <li key={log.id} style={{ color: 'var(--text)', lineHeight: 1.5 }}><span style={{ color: 'var(--text-faint)', marginRight: 8 }}>{log.log_date}</span>{log.content}</li>)}
              </ul>
            )}
          </Panel>
          {canManage && <Panel icon={<Target size={18} />} title="AI 자연어 실행"><ProjectCommandClient projectId={id} /></Panel>}
          <Panel icon={<ListChecks size={18} />} title={`실행 항목 ${items?.length ?? 0}건`}>
            <ProjectOperationsClient projectId={id} items={items ?? []} canManage={canManage} />
          </Panel>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Panel icon={<Building2 size={18} />} title="CRM 관계">
            <Detail label="거래처" value={account?.name} href={isAdmin && account?.id ? `/accounts/${account.id}` : undefined} />
            <Detail label="원본 영업기회" value={deal?.title} href={isAdmin && deal?.id ? `/deals/${deal.id}` : undefined} />
          </Panel>
          <Panel icon={<Target size={18} />} title="AI 작업공간"><Detail label="연결 상태" value={aiProject?.name ?? '미연결'} href={isAdmin && aiProject?.id ? `/ai-chat/projects/${aiProject.id}` : undefined} /></Panel>
          <Panel icon={<Users size={18} />} title={`참여자 ${members?.length ?? 0}명`}>
            {canManage ? <ProjectMembersClient projectId={id} initialMembers={members ?? []} profiles={profiles ?? []} /> : (members ?? []).map((member: { user_id: string; role: string; profiles: { name?: string; position?: string } | null }) => (
              <div key={member.user_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', padding: 'var(--space-2) 0', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
                <span>{member.profiles?.name ?? '이름 없음'}{member.profiles?.position ? ` · ${member.profiles.position}` : ''}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{roleLabel(member.role)}</span>
              </div>
            ))}
          </Panel>
          {deal && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}><Handshake size={16} /> 영업 단계: {deal.stage}</div>}
        </aside>
      </div>
    </WorkPageShell>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg)', padding: 'var(--space-4)' }}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 var(--space-3)', fontSize: 'var(--fs-md)' }}>{icon}{title}</h2>{children}</section>
}
function Summary({ label, value }: { label: string; value: string }) {
  return <div style={{ border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-3)', background: 'var(--surface-bg)' }}><div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>{label}</div><strong style={{ display: 'block', marginTop: 4 }}>{value}</strong></div>
}
function Detail({ label, value, href }: { label: string; value?: string | null; href?: string }) {
  const content = value || '미지정'
  return <div style={{ marginBottom: 'var(--space-3)' }}><div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)', marginBottom: 4 }}>{label}</div>{href && value ? <Link href={href} style={{ color: 'var(--brand)', fontWeight: 600 }}>{content}</Link> : <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>}</div>
}
function visibilityLabel(value: string): string { return ({ private: '비공개', members: '참여자', department: '부서', organization: '전사', admin_only: '관리자' } as Record<string, string>)[value] ?? '비공개' }
function roleLabel(value: string): string { return ({ owner: '책임자', manager: '운영자', contributor: '참여자', viewer: '조회자', stakeholder: '이해관계자' } as Record<string, string>)[value] ?? value }
