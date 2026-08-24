// lib/vercel/config.ts — Vercel 접속 설정 한 곳 (SSOT)
//
// ## 왜 환경변수가 아니라 DB 인가
//
// 환경변수로 두면 값을 넣는 사람이 **배포 대시보드에 들어갈 수 있는 사람**으로 좁혀진다.
// 그런데 이 값이 필요한 이유는 정반대다 — "배포 대시보드까지 가지 않고 우리 화면에서 보려고".
// 그래서 다른 외부 연동(Gemini·Groq·YouTube)과 **같은 자리**(org_content META)에 둔다.
// 시스템 설정 → 외부 연동에서 관리자가 직접 넣고 「연결 테스트」로 확인한다(§2-5).
//
// ## 토큰은 화면으로 나가지 않는다
//
// 이 모듈을 거치지 않고 META 를 직접 읽어 토큰을 컴포넌트로 넘기면 그 순간 유출 경로가 된다.
// 읽기는 서버 전용 경로(API 라우트·서버액션)에서만 하고, 화면에는 `maskToken()` 결과만 준다.

/** META 에 저장하는 키 이름. 화면·액션·API 가 같은 문자열을 각자 적지 않게 여기서만 정한다 */
export const VERCEL_META = {
  token: 'vercel_api_token',
  projectId: 'vercel_project_id',
  teamId: 'vercel_team_id',
} as const

export interface VercelConfig {
  token: string
  /** `prj_...` 또는 프로젝트 이름. Vercel은 둘 다 받는다 */
  projectId: string
  /** 팀 소유 프로젝트면 필요하다. 개인 프로젝트면 빈 값 */
  teamId: string | null
}

/**
 * 설정이 왜 없는지까지 말한다.
 *
 * 그냥 `null` 을 돌려주면 화면은 "로그가 없습니다"라고 말하게 된다 —
 * **연동이 안 된 것**과 **로그가 0건인 것**은 관리자가 해야 할 일이 완전히 다르다.
 */
export type ConfigResult =
  | { ok: true; config: VercelConfig }
  | { ok: false; reason: 'no-token' | 'no-project'; message: string }

export function readVercelConfig(meta: Record<string, unknown>): ConfigResult {
  const token = str(meta[VERCEL_META.token])
  const projectId = str(meta[VERCEL_META.projectId])
  const teamId = str(meta[VERCEL_META.teamId])

  if (!token) {
    return {
      ok: false,
      reason: 'no-token',
      message: 'Vercel 연동이 아직 안 돼 있습니다. 시스템 설정 → 외부 연동에서 토큰을 넣어 주세요.',
    }
  }
  if (!projectId) {
    return {
      ok: false,
      reason: 'no-project',
      message: '토큰은 있는데 프로젝트가 지정돼 있지 않습니다. 시스템 설정 → 외부 연동에서 프로젝트를 넣어 주세요.',
    }
  }
  return { ok: true, config: { token, projectId, teamId: teamId || null } }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 화면에 보여 줄 토큰 표기. 앞뒤만 남긴다.
 *
 * 다른 연동 카드와 **같은 모양**으로 자른다(§2-5 용어·모양 통일) — 카드마다 마스킹이 다르면
 * 관리자는 "이건 다른 종류의 값인가" 하고 읽는다.
 */
export function maskToken(token: string): string {
  const t = token.trim()
  if (t.length <= 8) return '••••••••'
  return `${t.slice(0, 5)}••••••••${t.slice(-4)}`
}
