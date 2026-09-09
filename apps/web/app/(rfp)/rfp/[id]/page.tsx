// /rfp/[id] — 리포트와 원문
//
// 리포트와 블록을 서버에서 함께 읽는다. 근거를 눌렀을 때 원문을 다시 부르면
// 그 왕복 동안 화면이 멈춘 것처럼 보인다.

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReportClient from './ReportClient'
import type { SourceBlock } from '@/components/rfp/SourceViewer'
import type { Report } from '@/lib/rfp/report/schema'
import type { DocClass } from '@/lib/rfp/domain/doc-class'
import type { FitVerdict } from '@/lib/rfp/terms'

export const dynamic = 'force-dynamic'

export default async function RfpReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await createClient()

  const { data: kase } = await (db as never as Db)
    .from('rfp_cases').select('id, title, doc_class').eq('id', id).maybeSingle()
  if (!kase) notFound()

  const [{ data: version }, { data: fit }] = await Promise.all([
    (db as never as Db).from('rfp_report_versions')
      .select('report').eq('case_id', id).order('version', { ascending: false }).limit(1).maybeSingle(),
    (db as never as Db).from('rfp_fit_assessments')
      .select('verdict, score, conditional').eq('case_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  // 블록은 케이스에 직접 안 달려 있다 — 파일 → IR → 블록으로 내려간다.
  // (`rfp_doc_blocks` 에 `case_id` 가 없다. 없는 칸으로 물으면 원문 뷰어가 영영 빈다)
  const blocks = await loadBlocks(db, id)

  return (
    <ReportClient
      caseId={id}
      caseTitle={String((kase as { title?: unknown }).title ?? '')}
      docClass={(kase as { doc_class?: unknown }).doc_class as DocClass}
      report={((version as { report?: unknown } | null)?.report as Report) ?? null}
      blocks={blocks}
      fit={fit
        ? {
            verdict: (fit as { verdict?: unknown }).verdict as FitVerdict,
            score: Number((fit as { score?: unknown }).score ?? 0),
            conditional: Boolean((fit as { conditional?: unknown }).conditional),
          }
        : null}
    />
  )
}

interface BlockRow { block_key: string; text: string | null; page_no: number | null; type: string | null }

/** 케이스의 원문 블록 — 파일과 IR 을 거쳐 내려간다 */
async function loadBlocks(db: unknown, caseId: string): Promise<SourceBlock[]> {
  const q = db as never as {
    from(t: string): {
      select(c: string): {
        eq(col: string, v: string): { is(col: string, v: null): Promise<{ data: unknown }> }
        in(col: string, v: string[]): {
          order(col: string, o: { ascending: boolean }): { limit(n: number): Promise<{ data: unknown }> }
        }
      }
    }
  }

  const { data: files } = await q.from('rfp_document_files').select('id').eq('case_id', caseId).is('deleted_at', null)
  const fileIds = ((files as { id: string }[] | null) ?? []).map((f) => f.id)
  if (fileIds.length === 0) return []

  const { data: irs } = await q.from('rfp_document_ir').select('id').in('file_id', fileIds)
    .order('version', { ascending: false }).limit(50)
  const irIds = ((irs as { id: string }[] | null) ?? []).map((r) => r.id)
  if (irIds.length === 0) return []

  const { data: rows } = await q.from('rfp_doc_blocks').select('block_key, text, page_no, type')
    .in('ir_id', irIds).order('order_no', { ascending: true }).limit(2000)

  return ((rows as BlockRow[] | null) ?? []).map((b) => ({
    blockId: String(b.block_key),
    text: String(b.text ?? ''),
    pageNo: b.page_no ?? null,
    type: String(b.type ?? 'paragraph'),
  }))
}

/** supabase-js 에서 이 화면이 쓰는 것만 */
interface Db {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: string): {
        maybeSingle(): Promise<{ data: unknown }>
        order(col: string, o: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown }> & {
            maybeSingle(): Promise<{ data: unknown }>
          }
        }
      }
    }
  }
}
