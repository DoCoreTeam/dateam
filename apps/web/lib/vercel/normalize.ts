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
import type { VercelDeployEvent, VercelDeployment } from './api.ts'

/** 로그 한 줄 본문 상한 — 스택이 그대로 오면 목록이 한 건으로 꽉 찬다 */
const MESSAGE_MAX = 2000

/* ── 배포 로그(빌드) ────────────────────────────────────────── */

export interface LogRow {
  id: string
  /** 배지에 쓰는 상태 토큰. 화면에서 색맵을 다시 만들지 않는다(§1) */
  status: StatusKey
  /** 배지 글자 — 색만으로 구분하지 않는다(흑백 출력·색각) */
  levelLabel: string
  level: 'error' | 'warning' | 'info'
  /** ISO — 표시는 화면이 KST 로 바꾼다(`lib/datetime/kst.ts`) */
  at: string
  /** 빌드 단계 이름 등. 없으면 스트림 이름(stdout/stderr) */
  sourceLabel: string
  message: string
  truncated: boolean
}

const LEVEL: Record<LogRow['level'], { label: string; status: StatusKey }> = {
  error: { label: '오류', status: 'blocker' },
  warning: { label: '주의', status: 'note' },
  info: { label: '진행', status: 'planned' },
}

/** 어디서 난 줄인지 — `stdout` 은 관리자에게 아무 뜻이 없다 */
const STREAM_LABELS: Record<string, string> = {
  stdout: '빌드 출력',
  stderr: '빌드 오류 출력',
  command: '명령',
  exit: '종료',
  fatal: '치명',
  'deployment-state': '배포 상태',
  middleware: '미들웨어',
  'middleware-invocation': '미들웨어 호출',
  'edge-function-invocation': '엣지 함수 호출',
  report: '보고',
  metric: '지표',
}

export function normalizeDeployEvent(e: VercelDeployEvent): LogRow {
  // Vercel 이 붙인 level 이 유일한 판정 근거다.
  // stderr 라는 것만으로 실패로 세면 안 된다 — npm·next 가 경고를 stderr 로 뱉는다
  // (실측: stderr 129줄 중 Vercel 이 오류로 표시한 것은 33줄뿐이었다).
  const level: LogRow['level'] = e.level === 'error' || e.type === 'fatal'
    ? 'error'
    : e.level === 'warning' ? 'warning' : 'info'
  const lv = LEVEL[level]
  const body = maskSecrets(e.text ?? '')
  return {
    id: e.id,
    status: lv.status,
    levelLabel: lv.label,
    level,
    at: new Date(e.date).toISOString(),
    sourceLabel: e.info?.name ?? STREAM_LABELS[e.type] ?? e.type,
    message: body.length > MESSAGE_MAX ? `${body.slice(0, MESSAGE_MAX)}…` : body,
    truncated: body.length > MESSAGE_MAX,
  }
}

/**
 * 관리자가 이 화면에서 찾는 것은 **실패**다(시스템 로그의 전제).
 * 그래서 기본은 오류·경고만 남긴다 — 다 보고 싶을 때만 켠다.
 */
export function isFailure(row: LogRow): boolean {
  return row.level !== 'info'
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
