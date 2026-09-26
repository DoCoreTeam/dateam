import 'server-only'

/**
 * CSV 를 읽어 봉으로 저장한다 (§6.1)
 *
 * **KIS 가 모은 줄을 안 덮는다.** `saveBars` 가 `ignoreDuplicates` 로 넣으므로
 * 같은 (월물, 봉 종류, 시작 시각) 이 이미 있으면 그대로 둔다.
 * 덮으면 우리가 직접 확인한 값이 외부 파일의 값으로 바뀌고,
 * 그 사실은 `source` 칼럼에도 안 남는다 — 이미 `import` 로 덮인 뒤라서.
 */

import { saveBars } from '../bars/store.ts'
import { parseBarCsv, importSummary, type CsvParseResult } from './csv-core.ts'

export interface ImportCsvInput {
  contractCode: string
  tf: '1m' | '5m' | '15m'
  text: string
  now: Date
}

export type ImportCsvResult =
  | { ok: true; saved: number; rejected: number; summary: string; mapping: Record<string, string> }
  | { ok: false; reason: string; userMessage: string }

/** 한 번에 넣는 줄 수. 한 방에 다 넣으면 큰 파일에서 한 요청이 너무 길어진다 */
const CHUNK = 2_000

export async function importBarCsv(input: ImportCsvInput): Promise<ImportCsvResult> {
  const parsed = parseBarCsv(input.text)
  if (!('bars' in parsed)) {
    return { ok: false, reason: parsed.reason, userMessage: parsed.userMessage }
  }
  const result = parsed as CsvParseResult
  if (result.bars.length === 0) {
    return {
      ok: false,
      reason: 'no_usable_rows',
      userMessage: `읽을 수 있는 줄이 없습니다 (${importSummary(result, 0)})`,
    }
  }

  let saved = 0
  for (let i = 0; i < result.bars.length; i += CHUNK) {
    const slice = result.bars.slice(i, i + CHUNK)
    const written = await saveBars({
      contractCode: input.contractCode,
      tf: input.tf,
      bars: slice,
      /**
       * 확인 시각은 **지금**이다. 봉 시각을 넣으면 as-of(§6.5)가 거짓말을 한다 —
       * 과거 시점 백테스트가 「그때 이미 알 수 있었다」로 이 줄을 읽게 된다
       */
      confirmedAt: input.now,
      source: 'import',
    })
    saved += written.saved
  }

  return {
    ok: true,
    saved,
    rejected: result.rejected.length,
    summary: importSummary(result, saved),
    mapping: result.mapping,
  }
}
