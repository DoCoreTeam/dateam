/**
 * 응답으로 내보낼 값 — bigint 를 문자열로, Prisma Decimal 을 문자열로
 *
 * JSON.stringify 는 bigint 를 만나면 그 자리에서 던진다. 엔진 결과는 금액이 깊이 들어 있어
 * 칸마다 손으로 바꾸면 하나를 빠뜨린다. 그래서 한 번에 훑는다.
 */

export function jsonSafe(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  if (v === null || v === undefined) return v ?? null
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(jsonSafe)
  if (typeof v === 'object') {
    // Prisma Decimal 은 toFixed 를 가진 객체다
    const o = v as Record<string, unknown> & { toFixed?: unknown; toString(): string }
    if (typeof o.toFixed === 'function' && typeof o.toString === 'function' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) {
      return o.toString()
    }
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = jsonSafe(x)
    return out
  }
  return v
}
