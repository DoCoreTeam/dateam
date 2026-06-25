// vitest→node:test 호환 shim (SSOT) — 단일 러너(node --test) 유지하면서
// vitest API(describe/it/expect)로 작성된 테스트를 그대로 실행시킨다.
//
// 왜: lib/gpu의 일부 테스트가 `from 'vitest'`로 작성됐으나 vitest는 미설치 →
//     node --test에서 ERR_MODULE_NOT_FOUND로 "조용히 안 돌던" 죽은 테스트였다.
//     (회귀 안전망 구멍 = "고쳐도 또 터지는" 근본원인 중 하나)
// 해결: 새 러너를 추가(=2중 러너)하지 않고, vitest 표면만 node:test/assert에 매핑.
//
// 지원 matcher: toBe·toEqual·toStrictEqual·toBeDefined·toBeNull·toBeUndefined·
//   toBeTruthy·toBeFalsy·toBeGreaterThan(OrEqual)·toBeLessThan(OrEqual)·
//   toContain·toHaveLength·toThrow + .not 체이닝. (현 테스트군이 쓰는 범위)
// 미지원(모듈 모킹 vi.mock)은 shim 대상 아님 — 해당 테스트는 node:test mock로 별도 작성.

import { test, describe as nodeDescribe } from 'node:test'
import assert from 'node:assert/strict'

export { nodeDescribe as describe }

// vitest의 it/test = node:test의 test. describe 내부에서도 동일 동작.
export const it = test
export { test }

type Matchers = {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toStrictEqual(expected: unknown): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeLessThan(n: number): void
  toBeLessThanOrEqual(n: number): void
  toContain(item: unknown): void
  toHaveLength(n: number): void
  toThrow(expected?: unknown): void
  not: Matchers
}

function build(received: unknown, negated: boolean): Matchers {
  const ok = (pass: boolean, msg: string) => {
    if (negated ? pass : !pass) assert.fail(msg)
  }
  const m: Matchers = {
    toBe: (e) => ok(Object.is(received, e), `expected ${received} ${negated ? 'not ' : ''}toBe ${e}`),
    toEqual: (e) => {
      let pass = true
      try { assert.deepEqual(received, e) } catch { pass = false }
      ok(pass, `expected ${negated ? 'not ' : ''}toEqual`)
    },
    toStrictEqual: (e) => {
      let pass = true
      try { assert.deepStrictEqual(received, e) } catch { pass = false }
      ok(pass, `expected ${negated ? 'not ' : ''}toStrictEqual`)
    },
    toBeDefined: () => ok(received !== undefined, `expected ${negated ? 'not ' : ''}toBeDefined`),
    toBeUndefined: () => ok(received === undefined, `expected ${negated ? 'not ' : ''}toBeUndefined`),
    toBeNull: () => ok(received === null, `expected ${negated ? 'not ' : ''}toBeNull`),
    toBeTruthy: () => ok(Boolean(received), `expected ${negated ? 'not ' : ''}toBeTruthy`),
    toBeFalsy: () => ok(!received, `expected ${negated ? 'not ' : ''}toBeFalsy`),
    toBeGreaterThan: (n) => ok((received as number) > n, `expected ${received} ${negated ? 'not ' : ''}> ${n}`),
    toBeGreaterThanOrEqual: (n) => ok((received as number) >= n, `expected ${received} ${negated ? 'not ' : ''}>= ${n}`),
    toBeLessThan: (n) => ok((received as number) < n, `expected ${received} ${negated ? 'not ' : ''}< ${n}`),
    toBeLessThanOrEqual: (n) => ok((received as number) <= n, `expected ${received} ${negated ? 'not ' : ''}<= ${n}`),
    toContain: (item) => {
      const pass = typeof received === 'string'
        ? received.includes(item as string)
        : Array.isArray(received) && received.includes(item)
      ok(pass, `expected ${negated ? 'not ' : ''}toContain ${item}`)
    },
    toHaveLength: (n) => ok((received as { length: number })?.length === n, `expected length ${negated ? 'not ' : ''}${n}, got ${(received as { length: number })?.length}`),
    toThrow: (expected) => {
      let threw = false
      let err: unknown
      try { (received as () => unknown)() } catch (e) { threw = true; err = e }
      const pass = expected === undefined
        ? threw
        : threw && String((err as Error)?.message ?? err).includes(String(expected))
      ok(pass, `expected fn ${negated ? 'not ' : ''}toThrow${expected ? ` ${expected}` : ''}`)
    },
    get not() { return build(received, !negated) },
  }
  return m
}

export function expect(received: unknown): Matchers {
  return build(received, false)
}
