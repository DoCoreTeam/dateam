// gcube 사이트 가격 읽기 SSOT — https://gcube.ai/ko/price 의 페이지 안 데이터(gpuPrices)를 그대로 받는다
//
// 화면 글을 긁지 않는다: 옛 방식(scripts/gcube-price-check.mjs)은 탭을 눌러 글을 맞추다 매일 실패했고 이름으로 이어 틀렸다
// 페이지는 Next 서버 렌더 조각(self.__next_f.push)에 상품 전부를 싣는다, 상품마다 고유 번호 ser 가 있다
// 금액은 원화 1시간 구성 전체, 최대 금액 = price + usagePrice (사이트 각주: 100% 사용 시 최대 금액 청구)
// 밖에서 온 값이라 숫자 아닌 값, 음수, 상한 초과 줄은 버린다

export const GCUBE_PRICE_URL = 'https://gcube.ai/ko/price'

/** 1시간 1억 원을 넘는 금액은 읽기 오류로 본다 */
export const GCUBE_MAX_KRW = 100_000_000
const MAX_GPU_COUNT = 64

export interface GcubeListing {
  ser: number
  gpu_name: string
  product_name: string | null
  product_code: string | null
  gpu_count: number
  vram_gb: number | null
  cpu: number | null
  memory_gb: number | null
  disk_gb: number | null
  base_krw: number
  usage_krw: number
  max_krw: number
}

export interface GcubeParseResult {
  listings: GcubeListing[]
  /** 버린 줄 수 (형식이 틀리거나 원화가 아니거나 상한 밖) */
  dropped: number
}

const PUSH_RE = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g
const KEY = '"gpuPrices":['

/** 서버 렌더 조각을 풀어 하나로 잇는다, 조각이 없으면 원문 그대로 */
function decodeFlight(html: string): string {
  const parts: string[] = []
  for (const m of html.matchAll(PUSH_RE)) {
    try {
      parts.push(JSON.parse(`"${m[1]}"`) as string)
    } catch {
      // 풀 수 없는 조각은 건너뛴다
    }
  }
  return parts.length > 0 ? parts.join('') : html
}

/** start 의 '[' 와 짝이 맞는 ']' 까지 잘라낸다, 글자열 안의 괄호는 센다에서 뺀다 */
function sliceArray(text: string, start: number): string | null {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** 사이트 한 줄을 받는다, 못 쓰는 줄은 null */
export function toListing(raw: unknown): GcubeListing | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ser = int(r.ser)
  const gpuName = text(r.gpuName)
  const gpuCount = int(r.gpu)
  const base = int(r.price)
  const usage = int(r.usagePrice) ?? 0
  if (ser == null || !Number.isInteger(ser) || ser <= 0 || !gpuName) return null
  if (gpuCount == null || !Number.isInteger(gpuCount) || gpuCount < 1 || gpuCount > MAX_GPU_COUNT) return null
  if ((text(r.currencyUnit) ?? 'KRW').toUpperCase() !== 'KRW') return null
  if (base == null || base < 0 || usage < 0 || base + usage <= 0 || base + usage > GCUBE_MAX_KRW) return null
  return {
    ser,
    gpu_name: gpuName,
    product_name: text(r.productName),
    product_code: text(r.productCode),
    gpu_count: gpuCount,
    vram_gb: int(r.vram),
    cpu: int(r.cpu),
    memory_gb: int(r.memory),
    disk_gb: int(r.disk),
    base_krw: base,
    usage_krw: usage,
    max_krw: base + usage,
  }
}

/** 사이트 줄 배열을 받는다, 같은 ser 가 또 나오면 앞의 것을 쓴다 */
export function toListings(rows: unknown[]): GcubeParseResult {
  const seen = new Set<number>()
  const listings: GcubeListing[] = []
  let dropped = 0
  for (const raw of rows) {
    const l = toListing(raw)
    if (!l || seen.has(l.ser)) {
      dropped++
      continue
    }
    seen.add(l.ser)
    listings.push(l)
  }
  return { listings, dropped }
}

/** 가격 페이지 HTML 에서 상품 전부를 꺼낸다, 데이터 자리를 못 찾으면 null (사이트 구조가 바뀐 것) */
export function parseGcubePricePage(html: string): GcubeParseResult | null {
  const flight = decodeFlight(html)
  const at = flight.indexOf(KEY)
  if (at < 0) return null
  const json = sliceArray(flight, at + KEY.length - 1)
  if (!json) return null
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return null
  }
  return Array.isArray(rows) ? toListings(rows) : null
}
