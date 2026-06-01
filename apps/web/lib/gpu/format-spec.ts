// GPU 상품 스펙 표시 포맷 — 4탭(가격표·시장비교·재고수량·고객판매가격표) 공통
// gpu_count는 표시 시점에 vCPU/RAM/스토리지를 곱해 구성별 총 스펙으로 환산한다.

interface SpecInput {
  gpu_count?: number
  vcpu?: number | null
  ram_gb?: number | null
  storage_gb?: number | null
  memory?: string | null
}

/** "VRAM 80GB · 124 vCPU · 240GB RAM · 512GB SSD" 형태의 스펙 요약 (숫자는 3자리 콤마) */
export function formatSpec(p: SpecInput): string {
  const parts: string[] = []
  if (p.memory) parts.push(`VRAM ${p.memory}`)
  if (p.vcpu) parts.push(`${p.vcpu.toLocaleString()} vCPU`)
  if (p.ram_gb) parts.push(`${p.ram_gb.toLocaleString()}GB RAM`)
  if (p.storage_gb) parts.push(`${formatStorage(p.storage_gb)} SSD`)
  return parts.join(' · ')
}

function formatStorage(gb: number): string {
  if (gb >= 1024) {
    const tb = gb / 1024
    return `${(tb % 1 === 0 ? tb : Number(tb.toFixed(1))).toLocaleString()}TB`
  }
  return `${gb.toLocaleString()}GB`
}

/** 파생(추정) 구성에서 1장당 스펙 × N으로 환산 */
export function scaleSpec(base: SpecInput, n: number): SpecInput {
  const baseCount = base.gpu_count && base.gpu_count > 0 ? base.gpu_count : 1
  const mult = n / baseCount
  return {
    gpu_count: n,
    vcpu: base.vcpu ? Math.round(base.vcpu * mult) : base.vcpu,
    ram_gb: base.ram_gb ? Math.round(base.ram_gb * mult) : base.ram_gb,
    storage_gb: base.storage_gb ? Math.round(base.storage_gb * mult) : base.storage_gb,
    memory: base.memory,
  }
}
