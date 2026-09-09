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

  const [outcome, revisions, vendors] = await Promise.all([
    loadOutcome(db, id),
    loadRevisions(db, id),
    loadVendors(db),
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
      outcome={outcome}
      revisions={revisions}
      vendors={vendors}
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

/** 참여 결정과 결과 — 없으면 폼이 빈 상태로 뜬다 */
async function loadOutcome(db: unknown, caseId: string) {
  const q = db as never as {
    from(t: string): { select(c: string): { eq(col: string, v: string): { maybeSingle(): Promise<{ data: unknown }> } } }
  }
  const { data } = await q.from('rfp_outcomes')
    .select('decision, submitted, result, awarded_to, awarded_amount, our_rank, source')
    .eq('case_id', caseId).maybeSingle()
  const r = data as Record<string, unknown> | null
  if (!r) return null
  return {
    decision: String(r.decision ?? 'undecided'),
    submitted: r.submitted === null || r.submitted === undefined ? null : Boolean(r.submitted),
    result: r.result === null || r.result === undefined ? null : String(r.result),
    awardedTo: r.awarded_to === null || r.awarded_to === undefined ? null : String(r.awarded_to),
    awardedAmount: r.awarded_amount === null || r.awarded_amount === undefined ? null : Number(r.awarded_amount),
    ourRank: r.our_rank === null || r.our_rank === undefined ? null : Number(r.our_rank),
    source: String(r.source ?? 'manual'),
  }
}

/** 같은 공고번호의 차수 사슬 — 앞 차수를 지우지 않기 때문에 남아 있다 */
async function loadRevisions(db: unknown, caseId: string) {
  const q = db as never as {
    from(t: string): {
      select(c: string): {
        eq(col: string, v: string): {
          maybeSingle(): Promise<{ data: unknown }>
          order(c: string, o: { ascending: boolean }): Promise<{ data: unknown }>
        }
      }
    }
  }
  const { data: mine } = await q.from('rfp_case_revisions').select('notice_no').eq('case_id', caseId).maybeSingle()
  const noticeNo = (mine as { notice_no?: unknown } | null)?.notice_no
  if (typeof noticeNo !== 'string') return []

  const { data } = await q.from('rfp_case_revisions')
    .select('case_id, round, is_latest').eq('notice_no', noticeNo)
    .order('round', { ascending: true })

  return ((data as { case_id: string; round: number; is_latest: boolean }[] | null) ?? [])
    .map((r) => ({ caseId: r.case_id, round: r.round, isLatest: r.is_latest }))
}

/** 교차검증에 쓸 모델들 */
async function loadVendors(db: unknown) {
  const q = db as never as {
    from(t: string): { select(c: string): { eq(col: string, v: boolean): { limit(n: number): Promise<{ data: unknown }> } } }
  }
  const { data } = await q.from('rfp_ai_models').select('id, display_name').eq('enabled', true).limit(10)
  return ((data as { id: string; display_name: string }[] | null) ?? [])
    .map((m) => ({ id: m.id, label: m.display_name }))
}

interface BlockRow {
  block_key: string
  text: string | null
  html: string | null
  page_no: number | null
  type: string | null
  section_id: string | null
}

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

  // **표와 섹션까지 읽는다.** 예전에는 글자만 읽어서 표 71개가 평문으로 뭉개졌고
  // 섹션 100개(번호·제목이 다 있는)를 화면이 못 썼다 —
  // 사용자가 「이게 문서로 나와 있는 건가」라고 물은 것의 정체다.
  const { data: rows } = await q.from('rfp_doc_blocks')
    .select('block_key, text, html, page_no, type, section_id')
    .in('ir_id', irIds).order('order_no', { ascending: true }).limit(2000)

  const { data: sectionRows } = await q.from('rfp_doc_sections')
    .select('id, number, title, level')
    .in('ir_id', irIds).order('order_no', { ascending: true }).limit(1000)

  const sections = new Map(
    ((sectionRows as SectionRow[] | null) ?? []).map((r) => [String(r.id), r]),
  )

  return ((rows as BlockRow[] | null) ?? []).map((b) => {
    const section = b.section_id ? sections.get(String(b.section_id)) : undefined
    return {
      blockId: String(b.block_key),
      text: String(b.text ?? ''),
      html: b.html ?? null,
      pageNo: b.page_no ?? null,
      type: String(b.type ?? 'paragraph'),
      sectionId: b.section_id ? String(b.section_id) : null,
      sectionNumber: section?.number ?? null,
      sectionTitle: section?.title ?? null,
      sectionLevel: section?.level ?? null,
    }
  })
}

interface SectionRow {
  id: string
  number: string | null
  title: string | null
  level: number | null
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
