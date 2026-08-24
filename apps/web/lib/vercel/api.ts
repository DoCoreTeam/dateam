// lib/vercel/api.ts — Vercel REST 호출 한 곳 (SSOT)
//
// ## 이 파일이 조심하는 것 셋 — 전부 실측에서 나왔다
//
// ① **커서를 잘못 쓰면 같은 페이지를 영원히 돈다.**
//    v0.7.572 작업 중 `page=` 로 넘기다 **같은 50건이 반복** 조회됐다. 그때는 "로그가 이만큼 많다"로
//    읽혀 오탐까지 냈다. 문서가 정한 커서는 `pagination.next`(타임스탬프)를 다음 요청의 `until` 로
//    넘기는 것이다. 그리고 그것만으로는 부족해서 — 커서가 안 움직이는 응답을 만나면 **멈춘다**(seen 가드).
//
// ② **런타임 로그 endpoint 는 이 계정에서 응답하지 않는다.**
//    문서가 말하는 `/v1/projects/{id}/deployments/{id}/runtime-logs` 는 **응답 헤더조차 오지 않는다.**
//    실측(2026-08-24): 파라미터 조합 4가지 · `Accept` 헤더 · **프로덕션에 실제 트래픽을 쏘면서** 30초 대기
//    — 전부 AbortError. 반면 `/v3/deployments/{id}/events` 는 **498ms 에 649건**을 준다.
//    그래서 되는 것을 쓴다. 안 되는 것을 붙여 놓고 "느립니다"라고 말하는 것은 기능이 아니다.
//
// ③ **모든 호출에 타임아웃.** 이 저장소는 타임아웃 없는 외부 호출로 화면이 33초·84초 매달린 적이 있다.
//
// 이 파일은 **네트워크만** 한다. 화면이 쓸 모양으로 바꾸는 일은 `normalize.ts` 가 맡는다.

import type { VercelConfig } from './config.ts'

const API_BASE = 'https://api.vercel.com'

/** 한 번의 REST 호출 상한 */
const REQUEST_TIMEOUT_MS = 10_000
/** 한 번에 가져올 로그 줄 수 상한 — 한 배포의 빌드 로그는 수백 줄이다 */
export const BUILD_LOG_MAX_ROWS = 500
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

/* ── 배포 로그(빌드) ────────────────────────────────────────── */

/**
 * 한 배포가 남긴 로그 한 줄.
 *
 * `level` 은 Vercel 이 오류·경고로 판정한 것에만 붙는다(실측: 649건 중 33건).
 * 안 붙은 줄은 그냥 진행 로그다 — 그걸 실패로 세면 목록이 전부 빨개진다.
 */
export interface VercelDeployEvent {
  id: string
  type: string
  text: string
  date: number
  level?: 'error' | 'warning'
  info?: { type?: string; name?: string; entrypoint?: string }
}

/** v2 는 payload 로 한 겹 감싸서 준다. 두 모양을 여기서 하나로 편다 */
interface RawEvent extends VercelDeployEvent {
  created?: number
  payload?: Partial<VercelDeployEvent> & { created?: number }
}

/**
 * 배포 하나의 로그. `direction=backward` 로 **최신부터** 받는다.
 *
 * `follow=0` 이 중요하다 — 빼면 이 endpoint 도 스트림으로 열려 끝나지 않는다.
 */
export async function fetchDeployEvents(
  config: VercelConfig,
  deploymentId: string,
  maxRows = BUILD_LOG_MAX_ROWS,
): Promise<{ events: VercelDeployEvent[]; capped: boolean }> {
  const sp = withTeam(new URLSearchParams(), config)
  sp.set('direction', 'backward')
  sp.set('follow', '0')
  sp.set('limit', String(Math.min(maxRows, 1000)))

  const raw = await callJson<RawEvent[]>(
    `/v3/deployments/${encodeURIComponent(deploymentId)}/events?${sp}`,
    config,
  )
  const list = Array.isArray(raw) ? raw : []
  const events = list.map(flattenEvent).filter((e): e is VercelDeployEvent => e !== null)
  return { events: events.slice(0, maxRows), capped: events.length > maxRows }
}

/** 두 응답 모양(평평한 v3 · payload 로 감싼 v2)을 하나로. 모르면 버린다 — 빈 줄을 만들지 않는다 */
function flattenEvent(e: RawEvent): VercelDeployEvent | null {
  const src = e.payload ?? e
  const date = src.date ?? e.date ?? e.created ?? src.created
  if (typeof date !== 'number') return null
  const text = typeof src.text === 'string' ? src.text : ''
  if (!text.trim()) return null
  return {
    id: String(src.id ?? `${date}-${eventSeq()}`),
    type: String(e.type ?? src.type ?? 'stdout'),
    text,
    date,
    level: src.level ?? e.level,
    info: src.info ?? e.info,
  }
}

/** id 가 없는 줄에도 안정적인 키를 준다 — React 목록이 키 없이 흔들리면 안 된다 */
let seq = 0
function eventSeq(): number { seq = (seq + 1) % 1_000_000; return seq }
