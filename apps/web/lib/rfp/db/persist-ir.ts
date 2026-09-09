/**
 * 파싱 결과를 남긴다 (rfp_document_ir / rfp_doc_sections / rfp_doc_blocks)
 *
 * ## 왜 표와 보관함 둘 다인가
 *
 * 표에는 **찾을 수 있어야 하는 것**만 넣는다 — 블록의 글자(trigram 색인), 섹션 트리,
 * 그리고 근거를 가리킬 uuid. 표·그림·쪽 정보처럼 통째로 다시 읽을 것은 표 구조가 없어
 * 보관함에 IR JSON 으로 둔다. 뒤 단계(요구사항·청크·분석)는 그 JSON 을 되읽는다.
 *
 * 이걸 안 나누면 둘 중 하나가 된다: 표를 더 만들어 스키마가 부풀거나,
 * 뒤 단계가 원문을 처음부터 다시 파싱해 같은 비용을 매번 낸다.
 *
 * ## 판을 덮는다
 *
 * 같은 (파일, 판) 을 다시 저장하면 **먼저 지우고 다시 넣는다.** 워커는 죽고,
 * 죽은 워커의 잡은 되살아나 다시 돈다 — 그때 섹션과 블록이 두 벌이 되면
 * 근거 링크가 어느 벌을 가리키는지 아무도 모른다.
 * 사용자가 「다시 분석」을 누르면 판이 올라가므로 앞 판의 근거는 그대로 남는다.
 */

import type { IrDocument } from '../ir/types.ts'

/** supabase-js 에서 우리가 쓰는 만큼만 */
export interface IrDbClient {
  from(table: string): any
}

export interface PersistIrInput {
  orgId: string
  fileId: string
  version: number
  doc: IrDocument
  /** 보관함에 둔 IR JSON 경로 */
  irStoragePath: string | null
}

export interface PersistIrResult {
  irId: string
  sectionCount: number
  blockCount: number
  /** blockKey → DB uuid. 뒤 단계가 근거를 uuid 로 가리킨다 */
  blockIdByKey: Map<string, string>
}

/** 한 번에 넣는 행 수. 크게 잡으면 요청 본문이 커져 게이트웨이가 끊는다 */
export const INSERT_CHUNK = 500

export async function persistIr(db: IrDbClient, input: PersistIrInput): Promise<PersistIrResult> {
  const { orgId, fileId, version, doc } = input

  // 같은 판이 있으면 지운다 — 섹션·블록은 on delete cascade 로 함께 사라진다
  const { error: delError } = await db
    .from('rfp_document_ir').delete().eq('file_id', fileId).eq('version', version)
  if (delError) throw new Error(`앞 판을 지우지 못했다: ${describe(delError)}`)

  const { data: irRow, error: irError } = await db
    .from('rfp_document_ir')
    .insert({
      file_id: fileId,
      org_id: orgId,
      version,
      parser: doc.meta.parser,
      parser_version: doc.meta.parserVersion,
      quality_score: Math.round(doc.meta.qualityScore),
      warnings: doc.meta.warnings,
      ir_storage_path: input.irStoragePath,
    })
    .select('id')
    .single()
  if (irError || !irRow) throw new Error(`파싱 결과를 남기지 못했다: ${describe(irError)}`)
  const irId = String(irRow.id)

  // ── 섹션: 부모를 나중에 잇는다 ──
  // 부모 uuid 는 부모를 넣어 봐야 안다. 한 번에 넣고 두 번째에 잇는 편이
  // 「부모부터 순서대로」보다 안전하다 — 순서를 믿으면 트리가 뒤엉킨 문서에서 조용히 깨진다.
  const sectionIdByKey = new Map<string, string>()
  if (doc.sections.length > 0) {
    for (const part of chunked(doc.sections, INSERT_CHUNK)) {
      const { data, error } = await db
        .from('rfp_doc_sections')
        .insert(part.map((s) => ({
          ir_id: irId,
          org_id: orgId,
          section_key: s.sectionId,
          level: s.level,
          title: s.title,
          number: s.number,
          category: s.category,
          page_start: s.pageStart,
          page_end: s.pageEnd,
          order_no: s.orderNo,
        })))
        .select('id, section_key')
      if (error) throw new Error(`섹션을 남기지 못했다: ${describe(error)}`)
      for (const row of (data ?? []) as { id: string; section_key: string }[]) {
        sectionIdByKey.set(row.section_key, String(row.id))
      }
    }

    // 부모 잇기 — 부모를 못 찾은 섹션은 최상위로 남는다(트리를 억지로 만들지 않는다)
    for (const s of doc.sections) {
      if (!s.parentId) continue
      const child = sectionIdByKey.get(s.sectionId)
      const parent = sectionIdByKey.get(s.parentId)
      if (!child || !parent) continue
      const { error } = await db.from('rfp_doc_sections').update({ parent_id: parent }).eq('id', child)
      if (error) throw new Error(`섹션 부모를 잇지 못했다: ${describe(error)}`)
    }
  }

  // ── 블록 ──
  const blockIdByKey = new Map<string, string>()
  for (const part of chunked(doc.blocks, INSERT_CHUNK)) {
    const { data, error } = await db
      .from('rfp_doc_blocks')
      .insert(part.map((b) => ({
        ir_id: irId,
        org_id: orgId,
        block_key: b.blockId,
        section_id: b.sectionId ? sectionIdByKey.get(b.sectionId) ?? null : null,
        type: b.type,
        text: b.text,
        html: b.html,
        page_no: b.pageNo,
        bbox: b.bbox ? [b.bbox.x0, b.bbox.y0, b.bbox.x1, b.bbox.y1] : null,
        source_ref: b.sourceRef,
        order_no: b.orderNo,
        text_hash: b.textHash,
        ocr_confidence: b.ocrConfidence,
      })))
      .select('id, block_key')
    if (error) throw new Error(`블록을 남기지 못했다: ${describe(error)}`)
    for (const row of (data ?? []) as { id: string; block_key: string }[]) {
      blockIdByKey.set(row.block_key, String(row.id))
    }
  }

  return {
    irId,
    sectionCount: sectionIdByKey.size,
    blockCount: blockIdByKey.size,
    blockIdByKey,
  }
}

/**
 * 이 파일의 최신 판을 찾는다.
 *
 * 「최신」은 `version` 이 큰 것이다. `created_at` 으로 고르면 되살아난 잡이
 * 앞 판을 다시 쓸 때 시각이 뒤집혀 옛 판이 최신이 된다.
 */
export async function latestIr(
  db: IrDbClient, fileId: string,
): Promise<{ id: string; version: number; irStoragePath: string | null } | null> {
  const { data, error } = await db
    .from('rfp_document_ir')
    .select('id, version, ir_storage_path')
    .eq('file_id', fileId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw new Error(`파싱 결과를 찾지 못했다: ${describe(error)}`)
  const row = (data ?? [])[0] as { id: string; version: number; ir_storage_path: string | null } | undefined
  return row ? { id: String(row.id), version: Number(row.version), irStoragePath: row.ir_storage_path } : null
}

/** blockKey → uuid. 뒤 단계가 근거를 uuid 로 가리키려면 이 표가 필요하다 */
export async function blockIdMap(db: IrDbClient, irId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data, error } = await db.from('rfp_doc_blocks').select('id, block_key').eq('ir_id', irId)
  if (error) throw new Error(`블록을 읽지 못했다: ${describe(error)}`)
  for (const row of (data ?? []) as { id: string; block_key: string }[]) {
    map.set(row.block_key, String(row.id))
  }
  return map
}

/** 큰 배열을 나눠 넣는다 */
export function chunked<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
