/**
 * 미리보기가 쓰는 바깥 호출을 한자리에 모은다
 *
 * 링크로 케이스를 만드는 창구도 같은 것을 쓴다. 두 벌로 두면 한쪽만 고쳐져
 * **미리보기에는 보이는 첨부가 실제로는 안 받아지는** 모양이 된다.
 */

import { readServiceKey, fetchNotice, FALLBACK_GUIDE } from '../g2b/client.ts'
import { attachmentsOf } from '../g2b/attachments.ts'
import { toSourceRow } from '../g2b/map.ts'
import { attachmentsFromPageDeep } from '../radar/attachments-from-page.ts'
import { fetchPage } from '../radar/site-collect.ts'
import type { PreviewDeps } from './notice-preview.ts'

/** 서비스 롤 클라이언트를 받아 진짜 호출로 채운다 */
export function realPreviewDeps(admin: unknown): PreviewDeps {
  return {
    serviceKey: () => readServiceKey(admin as never),
    fetchNotice: (input) => fetchNotice(input),
    attachmentsOf,
    toSourceRow,
    fetchPage: (url) => fetchPage(url),
    attachmentsFromPage: (html, url) => attachmentsFromPageDeep(html, url),
    noKeyGuide: FALLBACK_GUIDE.no_service_key,
  }
}
