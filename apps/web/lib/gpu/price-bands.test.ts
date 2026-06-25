import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { PRICE_BAND } from './validate.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

// SSOT 드리프트 가드(DC-REV M-2): 가격밴드가 TS(validate.ts) + SQL(060 메트릭·061 드릴다운) 3곳에 존재.
// 한 곳만 바꾸고 다른 곳 누락 시 anomaly 집계·표시·검증이 어긋남 → 이 테스트가 잡는다.
// SQL에서 `(g.tier=N AND (...< LOW OR ...> HIGH))` 패턴의 LOW/HIGH를 추출해 PRICE_BAND와 대조.

const ROOT = join(__dirname, '../../../..')
const SQL_FILES = [
  'supabase/migrations/060_data_quality_metrics.sql',
  'supabase/migrations/061_dq_drilldown.sql',
]

function extractBands(sql: string): Record<number, [number, number]> {
  const out: Record<number, [number, number]> = {}
  // 예: g.tier=1 AND (s.unit_price_usd < 0.08 OR s.unit_price_usd > 150)
  const re = /tier\s*=\s*(\d)\s+AND\s*\([^<]*<\s*([\d.]+)[^>]*>\s*([\d.]+)\)/gi
  let mch: RegExpExecArray | null
  while ((mch = re.exec(sql)) !== null) {
    out[Number(mch[1])] = [parseFloat(mch[2]), parseFloat(mch[3])]
  }
  return out
}

describe('가격밴드 SSOT 드리프트 (TS ↔ SQL 3곳 일치)', () => {
  for (const rel of SQL_FILES) {
    it(`${rel} 밴드가 validate.ts PRICE_BAND와 일치`, () => {
      const sql = readFileSync(join(ROOT, rel), 'utf8')
      const bands = extractBands(sql)
      // 각 SQL 파일이 최소 tier 1·2·3 밴드를 정의해야 함
      expect(Object.keys(bands).length).toBeGreaterThanOrEqual(3)
      for (const t of [1, 2, 3] as const) {
        expect(bands[t], `${rel}에 tier${t} 밴드 없음`).toBeDefined()
        expect(bands[t]).toEqual(PRICE_BAND[t])
      }
    })
  }
})
