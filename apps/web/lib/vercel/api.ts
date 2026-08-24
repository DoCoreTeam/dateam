// lib/vercel/api.ts — Vercel REST 호출 한 곳 (SSOT)
//
// ## 이 파일이 조심하는 것 셋 — 전부 실측에서 나왔다
//
// ① **커서를 잘못 쓰면 같은 페이지를 영원히 돈다.**
//    v0.7.572 작업 중 `page=` 로 넘기다 **같은 50건이 반복** 조회됐다. 그때는 "로그가 이만큼 많다"로
//    읽혀 오탐까지 냈다. 문서가 정한 커서는 `pagination.next`(타임스탬프)를 다음 요청의 `until` 로
//    넘기는 것이다. 그리고 그것만으로는 부족해서 — 커서가 안 움직이는 응답을 만나면 **멈춘다**(seen 가드).
//
// ② **런타임 로그는 끝나지 않는 스트림이다.** `application/stream+json` 은 최근 것을 뱉고 나서
//    계속 열려 있는다. 상한(시간·줄 수) 없이 읽으면 우리 API 라우트가 그대로 매달린다.
//    그래서 둘 다 건다 — 그리고 잘랐으면 **잘랐다고 말한다**(조용히 자르면 "이게 전부"로 읽힌다).
//
// ③ **모든 호출에 타임아웃.** 이 저장소는 타임아웃 없는 외부 호출로 화면이 33초·84초 매달린 적이 있다.
//
// 이 파일은 **네트워크만** 한다. 화면이 쓸 모양으로 바꾸는 일은 `normalize.ts` 가 맡는다.

import type { VercelConfig } from './config.ts'

const API_BASE = 'https://api.vercel.com'

/** 한 번의 REST 호출 상한 */
const REQUEST_TIMEOUT_MS = 10_000
/** 스트림을 붙들고 있을 최대 시간 — 이 endpoint 는 스스로 끝나지 않는다 */
const STREAM_TIMEOUT_MS = 8_000
/**
 * 첫 줄을 받은 뒤 이만큼 조용하면 "지금 있는 건 다 왔다"로 보고 끊는다.
 *
 * 상한만 두면 **매번 최대 시간을 꽉 채운다** — 이 endpoint 는 최근 것을 뱉고 나서
 * 새 요청이 오기를 계속 기다리기 때문이다. 그러면 탭을 열 때마다 8초씩 멈춘 것처럼 보인다.
 */
const STREAM_IDLE_MS = 1_500
/** 한 번에 가져올 런타임 로그 줄 수 상한 */
export const RUNTIME_LOG_MAX_ROWS = 300
/** 배포 목록을 커서로 훑을 때의 최대 페이지 수 — 무한 루프 최후 방어선 */
const MAX_PAGES = 20

/** 실패를 사람 말로. 관리자가 읽고 **다음에 할 일**을 알 수 있어야 한다 */
export type VercelFailReason = 'auth' | 'not-found' | 'rate-limit' | 'timeout' | 'network' | 'server'

export class VercelApiError extends Error {
  // 생성자 파라미터 프로퍼티는 쓰지 않는다 — 테스트가 도는 strip-only 모드가 그 문법을 못 읽는다
  readonly status: number | null
  readonly reason: VercelFailReason

  constructor(message: string, status: number | null, reason: VercelFailReason) {
    super(message)
    this.name = 'VercelApiError'
    this.status = status
    this.reason = reason
  }
}

function describe(status: number, body: string): VercelApiError {
  if (status === 401) return new VercelApiError('Vercel 토큰이 올바르지 않거나 만료됐습니다.', status, 'auth')
  if (status === 403) return new VercelApiError('이 토큰으로는 볼 수 없는 프로젝트입니다. 팀 프로젝트라면 팀 ID를 함께 넣어야 합니다.', status, 'auth')
  if (status === 404) return new VercelApiError('프로젝트나 배포를 찾지 못했습니다. 프로젝트 ID를 확인해 주세요.', status, 'not-found')
  if (status === 429) return new VercelApiError('Vercel 요청 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.', status, 'rate-limit')
  const tail = body.slice(0, 200)
  return new VercelApiError(`Vercel 응답 오류 (${status})${tail ? ` — ${tail}` : ''}`, status, 'server')
}

/** 팀 파라미터는 모든 endpoint 가 똑같이 받는다 — 호출부마다 적지 않는다 */
function withTeam(sp: URLSearchParams, config: VercelConfig): URLSearchParams {
  if (config.teamId) sp.set('teamId', config.teamId)
  return sp
}

async function call(path: string, config: VercelConfig, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: ctrl.signal,
      cache: 'no-store',
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new VercelApiError('Vercel 응답이 너무 늦어 기다리기를 멈췄습니다.', null, 'timeout')
    }
    throw new VercelApiError('Vercel에 연결하지 못했습니다.', null, 'network')
  } finally {
    clearTimeout(timer)
  }
}

async function callJson<T>(path: string, config: VercelConfig): Promise<T> {
  const res = await call(path, config)
  if (!res.ok) throw describe(res.status, await res.text().catch(() => ''))
  return (await res.json()) as T
}

/* ── 프로젝트 — 연결 테스트가 쓰는 가장 싼 호출 ─────────────────── */

export interface VercelProject { id: string; name: string }

export async function fetchProject(config: VercelConfig): Promise<VercelProject> {
  const sp = withTeam(new URLSearchParams(), config)
  const qs = sp.toString()
  return callJson<VercelProject>(
    `/v9/projects/${encodeURIComponent(config.projectId)}${qs ? `?${qs}` : ''}`,
    config,
  )
}

/* ── 배포 목록 ──────────────────────────────────────────────── */

export interface VercelDeployment {
  uid: string
  name: string
  url: string | null
  state?: string
  readyState: string
  created: number
  target: string | null
  source?: string
  inspectorUrl: string | null
  errorCode?: string
  errorMessage?: string | null
  meta?: Record<string, unknown>
}

interface DeploymentsResponse {
  deployments: VercelDeployment[]
  pagination: { count: number; next: number | null; prev: number | null }
}

export interface ListDeploymentsOptions {
  /** 가져올 총 개수 */
  limit: number
  /** 프로덕션만 볼지 */
  target?: 'production' | null
  /** 이 시각(ms) 이전 것부터 — 이어보기 커서 */
  until?: number | null
}

/**
 * 배포 목록. 한 페이지로 모자라면 **문서가 정한 커서**(`pagination.next` → `until`)로 이어 훑는다.
 *
 * 반환에 `nextCursor` 를 실어 화면이 '더 보기'를 할 수 있게 한다.
 * `stalled` 는 커서가 제자리를 도는 것을 우리가 끊었다는 뜻이다 — 조용히 멈추면
 * 관리자는 "여기까지가 전부"로 읽는다(①의 재발 방지).
 */
export async function listDeployments(
  config: VercelConfig,
  opts: ListDeploymentsOptions,
): Promise<{ deployments: VercelDeployment[]; nextCursor: number | null; stalled: boolean }> {
  const want = Math.max(1, Math.min(opts.limit, 100))
  const out: VercelDeployment[] = []
  const seen = new Set<string>()
  let cursor = opts.until ?? null
  let stalled = false

  for (let page = 0; page < MAX_PAGES && out.length < want; page += 1) {
    const sp = withTeam(new URLSearchParams(), config)
    sp.set('projectId', config.projectId)
    sp.set('limit', String(Math.min(want - out.length, 100)))
    if (opts.target) sp.set('target', opts.target)
    if (cursor != null) sp.set('until', String(cursor))

    const body = await callJson<DeploymentsResponse>(`/v7/deployments?${sp}`, config)
    const batch = body.deployments ?? []

    // 커서가 제자리를 돌면 여기서 걸린다 — 새 것이 하나도 없으면 더 부르지 않는다
    const fresh = batch.filter((d) => d.uid && !seen.has(d.uid))
    if (batch.length > 0 && fresh.length === 0) { stalled = true; break }
    for (const d of fresh) { seen.add(d.uid); out.push(d) }

    const next = body.pagination?.next ?? null
    if (next == null || next === cursor) { cursor = next; break }
    cursor = next
    if (batch.length === 0) break
  }

  return { deployments: out.slice(0, want), nextCursor: cursor, stalled }
}

/** 지금 프로덕션에 떠 있는 배포. 런타임 로그는 배포 하나를 지목해야 볼 수 있다 */
export async function findLatestProductionDeployment(config: VercelConfig): Promise<VercelDeployment | null> {
  const { deployments } = await listDeployments(config, { limit: 1, target: 'production' })
  return deployments[0] ?? null
}

/* ── 런타임 로그 ────────────────────────────────────────────── */

export interface VercelRuntimeLog {
  rowId: string
  level: 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warning'
  message: string
  messageTruncated: boolean
  source: 'delimiter' | 'edge-function' | 'edge-middleware' | 'request' | 'serverless'
  timestampInMs: number
  domain: string
  requestMethod: string
  requestPath: string
  responseStatusCode: number
}

/**
 * 배포 하나의 런타임 로그. **스스로 끝나지 않는 스트림**이라 우리가 끊는다(②).
 *
 * `capped` 는 상한에 닿아 잘랐다는 뜻이다. 화면이 그 사실을 반드시 표시한다.
 */
export async function fetchRuntimeLogs(
  config: VercelConfig,
  deploymentId: string,
  maxRows = RUNTIME_LOG_MAX_ROWS,
): Promise<{ logs: VercelRuntimeLog[]; capped: boolean }> {
  const sp = withTeam(new URLSearchParams(), config)
  const qs = sp.toString()
  const path = `/v1/projects/${encodeURIComponent(config.projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs${qs ? `?${qs}` : ''}`

  const res = await call(path, config, STREAM_TIMEOUT_MS)
  if (!res.ok) throw describe(res.status, await res.text().catch(() => ''))
  if (!res.body) return { logs: [], capped: false }

  return readNdjsonStream(res.body, maxRows, STREAM_TIMEOUT_MS, STREAM_IDLE_MS)
}

/**
 * NDJSON 스트림을 줄 단위로 읽는다. 줄 수 또는 시간 중 **먼저 닿는 쪽**에서 끊는다.
 *
 * 별도 함수인 이유: 이 규칙은 네트워크 없이 검증할 수 있어야 한다(테스트가 스트림만 넣어 본다).
 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  maxRows: number,
  timeoutMs: number,
  idleMs = timeoutMs,
): Promise<{ logs: VercelRuntimeLog[]; capped: boolean }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const logs: VercelRuntimeLog[] = []
  const deadline = Date.now() + timeoutMs
  let buffer = ''
  let capped = false

  try {
    while (logs.length < maxRows) {
      const remaining = deadline - Date.now()
      // 상한을 넘겼다 — 더 있는데 우리가 끊은 것이므로 잘랐다고 밝힌다
      if (remaining <= 0) { capped = true; break }

      // 스트림이 조용해도 영원히 기다리지 않는다.
      // 이미 받은 게 있으면 짧게(idle), 아직 한 줄도 못 받았으면 상한까지 기다린다.
      const wait = logs.length > 0 ? Math.min(remaining, idleMs) : remaining
      const step = await Promise.race([
        reader.read(),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), wait)),
      ])
      // 조용해서 끊은 것은 **자른 게 아니다** — 지금 있는 것이 그게 전부다
      if (step === 'timeout') { capped = wait >= remaining && logs.length > 0; break }
      if (step.done) break

      buffer += decoder.decode(step.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const row = parseLogLine(line)
        if (!row) continue
        logs.push(row)
        if (logs.length >= maxRows) { capped = true; break }
      }
    }
    // 마지막 줄이 개행 없이 끝났을 수 있다 — 버리면 한 건이 조용히 사라진다
    if (logs.length < maxRows) {
      const tail = parseLogLine(buffer)
      if (tail) logs.push(tail)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return { logs, capped }
}

/** 한 줄 → 로그. 깨진 줄은 **버리되 전체를 죽이지 않는다** — 스트림 한 줄 때문에 화면이 비면 안 된다 */
function parseLogLine(line: string): VercelRuntimeLog | null {
  const s = line.trim()
  if (!s) return null
  let parsed: unknown
  try { parsed = JSON.parse(s) } catch { return null }
  const o = parsed as Partial<VercelRuntimeLog>
  if (typeof o?.timestampInMs !== 'number') return null
  // 구분자 줄은 로그가 아니다 — 화면에 빈 줄로 나타난다
  if (o.source === 'delimiter') return null
  return {
    rowId: String(o.rowId ?? `${o.timestampInMs}-${logSeq()}`),
    level: (o.level ?? 'info') as VercelRuntimeLog['level'],
    message: String(o.message ?? ''),
    messageTruncated: Boolean(o.messageTruncated),
    source: (o.source ?? 'serverless') as VercelRuntimeLog['source'],
    timestampInMs: o.timestampInMs,
    domain: String(o.domain ?? ''),
    requestMethod: String(o.requestMethod ?? ''),
    requestPath: String(o.requestPath ?? ''),
    responseStatusCode: Number(o.responseStatusCode ?? 0),
  }
}

/** rowId 가 없는 줄에도 안정적인 키를 준다 — React 목록이 키 없이 흔들리면 안 된다 */
let seq = 0
function logSeq(): number { seq = (seq + 1) % 1_000_000; return seq }
