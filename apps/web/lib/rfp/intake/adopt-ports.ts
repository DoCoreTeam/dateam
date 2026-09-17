/**
 * 공고를 케이스로 만들 때 쓰는 진짜 호출을 한자리에 모은다
 *
 * 레이더가 고른 공고를 받는 길과 사람이 링크를 붙여넣는 길이 **같은 배선을 쓴다.**
 * 두 벌로 두면 한쪽만 고쳐지고, 그때 생기는 것은 「레이더로는 되는데 링크로는 안 되는」
 * 설명 안 되는 차이다.
 */

import { downloadAttachment } from '../g2b/attachments.ts'
import { filePath, putBytes } from '../db/storage.ts'
import { sha256Hex } from '../db/files.ts'
import { MAX_FILE_BYTES } from '../db/limits.ts'
import { guessFileRole } from '../parse/role.ts'
import { checkKind } from '../parse/quality.ts'
import { enqueueJob } from '../jobs/queue.ts'
import { dedupeKey, JOB_PRIORITY } from '../jobs/stages.ts'
import type { AdoptPorts } from './adopt-source.ts'

/** 같은 파일이 두 번 붙어 있으면 유니크가 막는다. 그건 실패가 아니다 */
const UNIQUE_VIOLATION = '23505'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function realAdoptPorts(db: any, admin: any): AdoptPorts {
  return {
    async findCase(sourceId) {
      const { data } = await db.from('rfp_cases')
        .select('id').eq('source_id', sourceId).is('deleted_at', null).maybeSingle()
      return data ? { id: String(data.id) } : null
    },

    async createCase(input) {
      const { data } = await db.from('rfp_cases').insert({
        org_id: input.orgId,
        source_id: input.sourceId,
        title: input.title,
        // 공고에서 온 이름은 사람이 정한 것이 아니다. 분석이 더 정확한 이름을 찾으면 대신한다
        title_confirmed: false,
        doc_class: input.docClass,
        budget_amount: input.budgetAmount,
        stage: 'uploaded',
        created_by: input.userId,
      }).select('id').single()
      return data ? { id: String(data.id) } : null
    },

    async download(att) {
      const got = await downloadAttachment(att, { maxBytes: MAX_FILE_BYTES })
      return got.ok
        ? { ok: true, fileName: got.fileName, bytes: got.bytes, contentType: got.contentType ?? null }
        : { ok: false, reason: got.reason }
    },

    async saveFile(input) {
      const sha = await sha256Hex(input.bytes)
      const path = filePath(input.orgId, input.caseId, sha)
      try {
        await putBytes(admin, path, input.bytes, input.contentType ?? undefined)
      } catch {
        return { failed: 'storage_failed' }
      }

      const kind = checkKind(input.fileName, input.bytes)
      const role = guessFileRole(input.fileName)
      const { error } = await admin.from('rfp_document_files').insert({
        case_id: input.caseId,
        org_id: input.orgId,
        role: role.role,
        original_name: input.fileName,
        storage_path: path,
        source_url: input.sourceUrl,
        mime: input.contentType,
        format: kind.ok ? kind.kind : null,
        size_bytes: input.bytes.byteLength,
        sha256: sha,
        uploaded_by: input.userId,
      })
      if (!error) return 'saved'
      return String((error as { code?: string }).code) === UNIQUE_VIOLATION
        ? 'duplicate'
        : { failed: 'insert_failed' }
    },

    async enqueueParse(input) {
      try {
        const job = await enqueueJob(db, {
          orgId: input.orgId,
          caseId: input.caseId,
          jobType: 'parse',
          payload: { requestedBy: input.userId, version: 1, from: 'source' },
          priority: JOB_PRIORITY.parse,
          dedupeKey: dedupeKey(input.caseId, 'parse', 1),
        })
        return { id: job.id, status: job.status }
      } catch {
        // 분석을 못 걸어도 케이스와 파일은 남는다. 화면에서 다시 걸 수 있다
        return null
      }
    },

    async markAdopted(sourceId, caseId) {
      await db.from('rfp_radar_hits').update({ status: 'adopted', case_id: caseId }).eq('source_id', sourceId)
    },
  }
}
