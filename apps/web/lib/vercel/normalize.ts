// lib/vercel/normalize.ts — Vercel 이 주는 것을 **우리 화면의 말**로 바꾼다 (SSOT)
//
// ## 왜 정규화 층이 따로 있나
//
// 시스템 로그 화면은 이미 어휘를 갖고 있다 — 심각도 배지(`StatusKey`) · 한 줄 제목 · 둘째 줄 사유 · 시각.
// Vercel 응답을 그대로 뿌리면 그 화면 안에서만 **영어와 다른 문법**이 흐른다.
// 관리자는 같은 화면에서 두 가지 읽는 법을 배워야 하고, 그 순간 "이건 개발자용"이 된다.
//
// ## 비밀은 여기서도 지운다
//
// 런타임 로그 본문에는 우리가 `console.error` 로 흘린 것이 그대로 온다 — 키가 섞일 수 있다.
// 마스킹은 시스템 로그가 이미 쓰는 `maskSecrets` 를 **재사용**한다. 두 번째 마스커를 만들지 않는다.

import { maskSecrets } from '../system-log/narrate.ts'
import type { StatusKey } from '../tokens/status-colors.ts'
import type { VercelDeployment, VercelRuntimeLog } from './api.ts'

/** 로그 한 줄 본문 상한 — 스택이 그대로 오면 목록이 한 건으로 꽉 찬다 */
const MESSAGE_MAX = 2000

/* ── 런타임 로그 ────────────────────────────────────────────── */

export interface LogRow {
  id: string
  /** 배지에 쓰는 상태 토큰. 화면에서 색맵을 다시 만들지 않는다(§1) */
  status: StatusKey
  /** 배지 글자 — 색만으로 구분하지 않는다(흑백 출력·색각) */
  levelLabel: string
  level: VercelRuntimeLog['level']
  /** ISO — 표시는 화면이 KST 로 바꾼다(`lib/datetime/kst.ts`) */
  at: string
  method: string
  path: string
  status_: number
  sourceLabel: string
  message: string
  truncated: boolean
}

/** 어디서 난 로그인지 — `serverless` 는 관리자에게 아무 뜻이 없다 */
const SOURCE_LABELS: Record<VercelRuntimeLog['source'], string> = {
  serverless: '서버 함수',
  'edge-function': '엣지 함수',
  'edge-middleware': '미들웨어',
  request: '요청',
  delimiter: '구분',
}

const LEVEL: Record<VercelRuntimeLog['level'], { label: string; status: StatusKey }> = {
  fatal: { label: '치명', status: 'blocker' },
  error: { label: '실패', status: 'blocker' },
  warning: { label: '주의', status: 'note' },
  info: { label: '정보', status: 'planned' },
  debug: { label: '디버그', status: 'planned' },
  trace: { label: '추적', status: 'planned' },
}

export function normalizeRuntimeLog(row: VercelRuntimeLog): LogRow {
  const lv = LEVEL[row.level] ?? LEVEL.info
  // 상태 코드가 5xx 면 level 이 info 라도 실패다 — Vercel 은 요청 로그를 info 로 준다
  const failedByStatus = row.responseStatusCode >= 500
  const body = maskSecrets(row.message ?? '')
  return {
    id: row.rowId,
    status: failedByStatus ? 'blocker' : lv.status,
    levelLabel: failedByStatus && lv.status !== 'blocker' ? '서버 오류' : lv.label,
    level: row.level,
    at: new Date(row.timestampInMs).toISOString(),
    method: row.requestMethod ?? '',
    path: row.requestPath ?? '',
    status_: row.responseStatusCode ?? 0,
    sourceLabel: SOURCE_LABELS[row.source] ?? row.source,
    message: body.length > MESSAGE_MAX ? `${body.slice(0, MESSAGE_MAX)}…` : body,
    truncated: Boolean(row.messageTruncated) || body.length > MESSAGE_MAX,
  }
}

/**
 * 관리자가 이 화면에서 찾는 것은 **실패**다(시스템 로그의 전제).
 * 그래서 기본은 실패만 남긴다 — 다 보고 싶을 때만 켠다.
 */
export function isFailure(row: LogRow): boolean {
  return row.status === 'blocker' || row.level === 'warning' || row.status_ >= 400
}

/* ── 배포 ──────────────────────────────────────────────────── */

export interface DeployRow {
  id: string
  status: StatusKey
  stateLabel: string
  state: string
  at: string
  url: string | null
  inspectorUrl: string | null
  target: string
  /** 어떤 커밋이 올라갔나 — 배포가 깨졌을 때 관리자가 가장 먼저 찾는 것 */
  commitMessage: string | null
  branch: string | null
  author: string | null
  errorMessage: string | null
}

const STATE: Record<string, { label: string; status: StatusKey }> = {
  READY: { label: '배포됨', status: 'done' },
  BUILDING: { label: '빌드 중', status: 'doing' },
  INITIALIZING: { label: '준비 중', status: 'doing' },
  QUEUED: { label: '대기 중', status: 'planned' },
  ERROR: { label: '배포 실패', status: 'blocker' },
  CANCELED: { label: '취소됨', status: 'note' },
  BLOCKED: { label: '차단됨', status: 'blocker' },
  DELETED: { label: '삭제됨', status: 'note' },
}

export function normalizeDeployment(d: VercelDeployment): DeployRow {
  const state = d.state ?? d.readyState
  const s = STATE[state] ?? { label: state, status: 'note' as StatusKey }
  const meta = (d.meta ?? {}) as Record<string, unknown>
  return {
    id: d.uid,
    status: s.status,
    stateLabel: s.label,
    state,
    at: new Date(d.created).toISOString(),
    url: d.url ? `https://${d.url}` : null,
    inspectorUrl: d.inspectorUrl,
    // 값이 없을 때 '프리뷰'라고 지어내지 않는다 — Vercel 은 target 이 null 인 배포를 준다
    target: d.target ?? '미지정',
    commitMessage: firstString(meta, ['githubCommitMessage', 'gitlabCommitMessage', 'bitbucketCommitMessage']),
    branch: firstString(meta, ['githubCommitRef', 'gitlabCommitRef', 'bitbucketCommitRef']),
    author: firstString(meta, ['githubCommitAuthorName', 'gitlabCommitAuthorName', 'bitbucketCommitAuthorName']),
    errorMessage: d.errorMessage ? maskSecrets(d.errorMessage) : null,
  }
}

/** Git 제공자마다 키 이름이 다르다. 없는 것은 null 로 둔다 — 빈 문자열은 "있는데 비었다"로 읽힌다 */
function firstString(meta: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}
