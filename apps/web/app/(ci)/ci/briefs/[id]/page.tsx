// app/(ci)/ci/briefs/[id]/page.tsx — P02 기획안 편집기 + P03 편집안
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import CiPageHeader from '@/components/ci/CiPageHeader'
import BriefEditor from './BriefEditor'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const { id } = await params
  const adminClient = createAdminClient() as any

  const { data: brief } = await adminClient.from('ci_briefs')
    .select('id, idea_id, version, title_options, hook, script, caption, tags, thumbnail_specs, status, generated_by, ci_ideas ( title )')
    .eq('id', id).eq('workspace_id', workspace.id).maybeSingle()
  if (!brief) notFound()

  const [{ data: versions }, { data: plans }] = await Promise.all([
    adminClient.from('ci_briefs').select('id, version, created_at')
      .eq('idea_id', brief.idea_id).order('version', { ascending: false }),
    adminClient.from('ci_edit_plans').select('id, variant_label, timecodes, export_status, created_at')
      .eq('brief_id', id).order('created_at', { ascending: false }),
  ])

  return (
    <>
      <CiPageHeader
        title={brief.ci_ideas?.title ?? '기획안'}
        desc={`버전 ${brief.version} · ${brief.generated_by === 'ai' ? 'AI 초안' : '직접 작성'}`}
        actions={<Link href="/ci/pipeline" className="btn-ghost">파이프라인으로</Link>}
      />
      <BriefEditor
        workspaceId={workspace.id}
        brief={{
          id: brief.id,
          ideaId: brief.idea_id,
          version: brief.version,
          titleOptions: brief.title_options ?? [],
          hook: brief.hook ?? '',
          script: brief.script ?? '',
          caption: brief.caption ?? '',
          tags: brief.tags ?? [],
          thumbnailIdeas: brief.thumbnail_specs?.ideas ?? [],
          status: brief.status,
        }}
        versions={(versions ?? []).map((v: any) => ({ id: v.id, version: v.version }))}
        editPlans={(plans ?? []).map((p: any) => ({
          id: p.id, label: p.variant_label ?? '기본안',
          timecodes: p.timecodes ?? [], exportStatus: p.export_status,
        }))}
      />
    </>
  )
}
