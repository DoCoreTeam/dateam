// 표준 구성 사다리(×1/×2/×4/×8) 실제 적재 — 견적 등록 시 호출.
// 화면 전용 파생이 아니라 실제 gpu_products 행을 생성해 4탭+스펙관리 전부 일관.

const STD_CONFIGS = [1, 2, 4, 8]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ensureStandardConfigs(adminDb: any, modelName: string): Promise<void> {
  try {
    const { data: rows } = await adminDb
      .from('gpu_products')
      .select('id, model_name, tier, series, memory, gpu_count, vcpu, ram_gb, storage_gb, pricing_mode')
      .eq('model_name', modelName)
    const quoteRows = (rows ?? []).filter((r: { pricing_mode: string }) => r.pricing_mode === 'quote')
    if (quoteRows.length === 0) return

    const base = quoteRows.sort((a: { gpu_count: number }, b: { gpu_count: number }) => a.gpu_count - b.gpu_count)[0]
    const baseCount = Math.max(base.gpu_count, 1)
    const existing = new Set((rows ?? []).map((r: { gpu_count: number }) => r.gpu_count))
    const perCard = base.memory && /[0-9]/.test(String(base.memory))
      ? Number(String(base.memory).replace(/[^0-9]/g, '')) / baseCount : null

    const inserts = STD_CONFIGS.filter((n) => !existing.has(n)).map((n) => {
      const ratio = n / baseCount
      return {
        model_name: base.model_name, tier: base.tier, pricing_mode: 'quote', gpu_count: n, series: base.series,
        memory: perCard != null ? `${Math.round(perCard * n)}GB` : base.memory,
        vcpu: base.vcpu != null ? Math.round(base.vcpu * ratio) : base.vcpu,
        ram_gb: base.ram_gb != null ? Math.round(base.ram_gb * ratio) : base.ram_gb,
        storage_gb: base.storage_gb != null ? Math.round(base.storage_gb * ratio) : null,
      }
    })
    if (inserts.length > 0) await adminDb.from('gpu_products').insert(inserts)
  } catch {
    // 비치명적 — 사다리 생성 실패해도 견적 등록 자체는 유지
  }
}
