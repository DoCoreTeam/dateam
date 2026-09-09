// GET /api/rfp/cases/[id]/export?mode=work|report&format=md|html — 리포트 내보내기
//
// 작업용과 보고용은 **같은 JSON 에서** 나온다. 따로 만들면 두 문서가 다른 말을 하고,
// 그때 어느 쪽이 맞는지 아무도 모른다. 보고용은 근거·벤더·검증 배지를 뺄 뿐이다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { toMarkdown, type ExportMode } from '@/lib/rfp/export/markdown'
import { toPrintHtml } from '@/lib/rfp/export/pdf'
import type { Report } from '@/lib/rfp/report/schema'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const url = new URL(req.url)
  const mode: ExportMode = url.searchParams.get('mode') === 'report' ? 'report' : 'work'
  const format = url.searchParams.get('format') === 'html' ? 'html' : 'md'

  const db = await createClient()
  const { data: kase } = await (db as any)
    .from('rfp_cases')
    .select('id, title')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!kase) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  const { data: version } = await (db as any)
    .from('rfp_report_versions')
    .select('report, version, created_at')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'no_report' }, { status: 409 })

  const report = version.report as Report
  const opts = { mode, caseTitle: String(kase.title ?? ''), generatedAt: String(version.created_at ?? '') }

  const body = format === 'html' ? toPrintHtml(report, opts) : toMarkdown(report, opts)
  const ext = format === 'html' ? 'html' : 'md'
  const type = format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8'

  return new NextResponse(body, {
    headers: {
      'content-type': type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${kase.title}-v${version.version}-${mode}.${ext}`)}`,
    },
  })
}
