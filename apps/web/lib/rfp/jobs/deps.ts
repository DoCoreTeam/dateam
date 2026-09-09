/**
 * 단계와 바깥세상을 잇는다 — DB·보관함·파서·AI
 *
 * `run-stage.ts` 는 순서와 판정만 안다. 여기가 그 순서를 **실제 표와 파일**에 붙인다.
 * 둘을 나눈 이유는 하나다 — 붙인 채로 두면 「다음 잡을 걸었나」를 확인할 방법이
 * 실제 크론을 도는 것뿐이 된다.
 */

import { parseFile } from '../parse/index.ts'
import { buildSections, applySections } from '../structure/sections.ts'
import { extractRequirements } from '../structure/requirements.ts'
import { chunkDocument } from '../index/chunk.ts'
import { embedChunks, EMBEDDING_MODEL, type EmbedFn } from '../index/embed.ts'
import { persistIr, latestIr, blockIdMap, chunked } from '../db/persist-ir.ts'
import { getBytes, getJson, putJson, irPath } from '../db/storage.ts'
import type { IrDocument } from '../ir/types.ts'
import type { StageDeps, CaseRow, FileRow } from './run-stage.ts'
import { enqueueJob } from './queue.ts'

/** 여기서 쓰는 supabase-js 만큼 */
export interface AnyDb {
  from(table: string): any
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  storage: any
}

export interface AnalyzeFn {
  (kase: CaseRow, docs: { fileId: string; doc: IrDocument }[]): Promise<{ version: number; title: string | null }>
}

export interface MakeDepsInput {
  db: AnyDb
  analyze: AnalyzeFn
  /** 없으면 임베딩 없이 저장한다 — 검색은 글자 일치로 떨어진다(0건이 되지는 않는다) */
  embed?: EmbedFn | null
}

export function makeStageDeps(input: MakeDepsInput): StageDeps {
  const { db } = input

  return {
    async loadCase(caseId) {
      const { data } = await db.from('rfp_cases')
        .select('id, org_id, doc_class, title, title_confirmed')
        .eq('id', caseId).is('deleted_at', null).maybeSingle()
      if (!data) return null
      return {
        id: String(data.id),
        orgId: String(data.org_id),
        docClass: String(data.doc_class),
        title: String(data.title ?? ''),
        titleConfirmed: Boolean(data.title_confirmed),
      }
    },

    async loadFiles(caseId) {
      const { data } = await db.from('rfp_document_files')
        .select('id, role, original_name, storage_path')
        .eq('case_id', caseId).is('deleted_at', null)
        // 본문이 먼저 파싱돼야 뒤 단계가 그것을 주 문서로 삼는다
        .order('role', { ascending: true })
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        role: String(r.role ?? 'etc'),
        originalName: String(r.original_name ?? ''),
        storagePath: r.storage_path ? String(r.storage_path) : null,
      }))
    },

    async parseOne(file: FileRow) {
      let bytes: Uint8Array
      try {
        bytes = await getBytes(db as any, file.storagePath as string)
      } catch (e) {
        return { ok: false as const, reason: e instanceof Error ? e.message : 'no_bytes' }
      }
      const r = await parseFile({
        fileId: file.id, fileName: file.originalName, bytes, fileRole: file.role,
      })
      if (!r.ok) return { ok: false as const, reason: `${r.reason}${r.detail ? `:${r.detail}` : ''}` }

      // 섹션은 파싱 직후에 만든다 — 블록에 sectionId 가 박혀야 표에 그대로 남는다
      const withSections = applySections(r.doc, buildSections(r.doc))
      return { ok: true as const, doc: withSections }
    },

    async saveIr(file, doc, version) {
      const { data: kase } = await db.from('rfp_document_files')
        .select('org_id, case_id').eq('id', file.id).maybeSingle()
      const orgId = String(kase?.org_id)
      const caseId = String(kase?.case_id)

      // 표에는 찾을 것만, 보관함에는 통째로 — 표·그림은 표 구조가 없어 여기 아니면 사라진다
      const path = irPath(orgId, caseId, file.id, version)
      await putJson(db as any, path, doc)
      await persistIr(db as any, {
        orgId, fileId: file.id, version, doc, irStoragePath: path,
      })
    },

    async loadIrDocs(caseId) {
      const { data: files } = await db.from('rfp_document_files')
        .select('id').eq('case_id', caseId).is('deleted_at', null)
      const out: { fileId: string; doc: IrDocument }[] = []
      for (const f of ((files ?? []) as { id: string }[])) {
        const ir = await latestIr(db as any, String(f.id))
        if (!ir?.irStoragePath) continue
        try {
          out.push({ fileId: String(f.id), doc: await getJson<IrDocument>(db as any, ir.irStoragePath) })
        } catch {
          // 한 파일의 IR 이 없어도 나머지로 이어 간다
        }
      }
      return out
    },

    async saveRequirements(kase, docs) {
      // 다시 돌려도 두 벌이 안 되게 케이스 단위로 지우고 다시 넣는다
      await db.from('rfp_requirements').delete().eq('case_id', kase.id)

      const rows: Record<string, unknown>[] = []
      for (const { fileId, doc } of docs) {
        const ir = await latestIr(db as any, fileId)
        const idByKey = ir ? await blockIdMap(db as any, ir.id) : new Map<string, string>()
        for (const req of extractRequirements(doc).requirements) {
          rows.push({
            org_id: kase.orgId,
            case_id: kase.id,
            req_code: req.code,
            category: req.kind,
            title: req.title,
            description: req.description,
            // 근거는 uuid 로 가리킨다 — blockKey 그대로 두면 화면이 원문을 못 찾는다
            evidence_block_ids: [idByKey.get(req.blockId)].filter((v): v is string => Boolean(v)),
          })
        }
      }
      if (rows.length === 0) return 0
      for (const part of chunked(rows, 500)) {
        const { error } = await db.from('rfp_requirements').insert(part)
        if (error) throw new Error(`요구사항을 남기지 못했다: ${String((error as any)?.message ?? error)}`)
      }
      return rows.length
    },

    async saveChunks(kase, docs) {
      await db.from('rfp_block_chunks').delete().eq('case_id', kase.id)

      const rows: Record<string, unknown>[] = []
      for (const { fileId, doc } of docs) {
        const ir = await latestIr(db as any, fileId)
        const idByKey = ir ? await blockIdMap(db as any, ir.id) : new Map<string, string>()

        const chunks = chunkDocument(doc)
        // 임베딩이 없으면 null 로 둔다 — 검색이 글자 일치로 떨어질 뿐 0건이 되지는 않는다
        const embedded = input.embed
          ? await embedChunks(chunks, input.embed, EMBEDDING_MODEL)
          : chunks.map((c) => ({ ...c, embedding: null, embeddingModel: null }))

        for (const c of embedded) {
          rows.push({
            org_id: kase.orgId,
            case_id: kase.id,
            file_id: fileId,
            block_ids: c.blockIds.map((k) => idByKey.get(k)).filter((v): v is string => Boolean(v)),
            text: c.text,
            embedding: c.embedding,
            embedding_model: c.embeddingModel,
          })
        }
      }
      if (rows.length === 0) return 0
      for (const part of chunked(rows, 200)) {
        const { error } = await db.from('rfp_block_chunks').insert(part)
        if (error) throw new Error(`청크를 남기지 못했다: ${String((error as any)?.message ?? error)}`)
      }
      return rows.length
    },

    analyze: input.analyze,

    async setStage(caseId, stage) {
      const { error } = await db.from('rfp_cases').update({ stage }).eq('id', caseId)
      if (error) throw new Error(`단계를 올리지 못했다: ${String((error as any)?.message ?? error)}`)
    },

    async setTitle(caseId, title) {
      await db.from('rfp_cases').update({ title }).eq('id', caseId)
    },

    async enqueue(i) {
      await enqueueJob(db as any, {
        orgId: i.orgId, caseId: i.caseId, jobType: i.jobType,
        // 판 번호를 물려준다 — 안 물려주면 뒤 단계가 1판으로 돌아 IR 이 두 벌이 된다
        payload: { version: i.version }, priority: i.priority, dedupeKey: i.dedupeKey,
      })
    },
  }
}
