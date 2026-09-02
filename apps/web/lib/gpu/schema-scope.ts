/**
 * AI 프롬프트에 실을 DB 스키마를 **GPU 도메인으로 좁힌다.**
 *
 * 왜(실측 v0.7.683): `get_schema_digest()` 는 DB **전체**를 준다 —
 * 테이블 253개 / 129,804자. 그중 GPU 추출이 실제로 쓰는 것은 **15개 6,027자**로
 * **95.4%가 잡음**이었다. 백업 테이블(`_bak_ci_channels_20260811`)과 CI·CRM 스키마까지
 * 견적서 추출 프롬프트에 실려 있었다.
 *
 * 이 130KB 가 전사·분류·본추출·재추출 **호출마다** 들어가 매 호출을 느리게 만들었고,
 * 라우트 예산(50초)이 **본 추출에 닿기 전에** 소진돼 견적서 분석이 4/4 실패했다
 * (본 추출이 받은 예산: 6.0초 · 13.8초 · 30.9초 · 17.0초 — 전부 시간 초과).
 * 모델은 멀쩡했다 — 같은 키·같은 모델로 짧은 프롬프트는 1.7초에 답했다.
 *
 * 즉 이건 「AI 가 느리다」가 아니라 **우리가 필요 없는 것을 매번 보냈다**는 문제다.
 */

/**
 * 프롬프트에 남길 테이블 — GPU 견적 추출·시세·프롬프트 거버넌스가 읽고 쓰는 것만.
 * 접두사로 적는다(테이블이 하나 늘 때마다 여기를 고쳐야 하는 손목록이 되지 않게).
 */
export const GPU_SCHEMA_TABLE_PREFIXES: readonly string[] = [
  'gpu_',              // gpu_products · gpu_specs · gpu_intake_* · gpu_model_candidates …
  'supply_',           // supply_quotes · supply_history_stats
  'competitor',        // competitors · competitor_product_mapping
  'market_',           // market_prices · market_price_components · market_refresh_runs …
  'price_',            // price_range_learned
  'fx_rates',          // fx_rates · fx_rates_multi (통화 환산)
  'ai_prompt',         // ai_prompts · ai_prompt_revisions · ai_prompt_outcomes (자가합성·거버넌스)
  'ai_model_catalog',
  'ai_token_logs',
]

/**
 * 백업·스냅샷 테이블 — 이름만 비슷할 뿐 **쓰지 않는다.**
 * 이것들이 들어오면 AI 가 «비슷한 이름의 표 두 개» 를 보고 어디에 넣을지 헷갈린다.
 */
export const BACKUP_TABLE_MARKERS: readonly string[] = ['_bak_', '_backup', '_dedup_backup']

/** 다이제스트 한 줄에서 테이블 이름을 뽑는다. 형식: `TABLE name (col type, …)` */
export function tableNameOf(line: string): string | null {
  const m = /^TABLE\s+([A-Za-z0-9_.]+)/.exec(line)
  return m ? m[1] : null
}

/** 이 테이블을 프롬프트에 실을지 — 허용목록에 있고 백업이 아니어야 한다. */
export function isGpuScopedTable(name: string): boolean {
  if (BACKUP_TABLE_MARKERS.some((m) => name.includes(m))) return false
  return GPU_SCHEMA_TABLE_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * 다이제스트를 GPU 도메인만 남기고 줄인다.
 *
 * 형식이 **블록**이라 줄 단위로 거르면 안 된다 — `TABLE …` 다음의 들여쓴 줄
 * (`  · CHECK …` · `  → FOREIGN KEY …`)은 **앞 테이블의 것**이다.
 * 줄 단위로 지우면 남의 제약이 엉뚱한 테이블에 붙는다.
 *
 * 입력이 비었거나 `TABLE` 줄이 하나도 없으면(형식이 바뀐 것) **원본을 그대로 돌려준다** —
 * 잘못 걸러 빈 스키마를 보내느니 큰 스키마를 보내는 편이 낫다.
 */
export function scopeSchemaDigest(digest: string): string {
  if (!digest || !digest.includes('TABLE ')) return digest
  const out: string[] = []
  let keeping = false
  for (const line of digest.split('\n')) {
    const name = tableNameOf(line)
    if (name !== null) {
      keeping = isGpuScopedTable(name)
      if (keeping) out.push(line)
      continue
    }
    // 테이블에 딸린 줄(들여쓰기) — 직전 테이블의 판정을 따른다.
    if (keeping) out.push(line)
  }
  const kept = out.join('\n').trim()
  // 하나도 못 건졌다 = 허용목록이 현실과 어긋났다는 뜻이다. 조용히 빈 값을 보내지 않는다.
  return kept.length > 0 ? kept : digest
}
