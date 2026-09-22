/**
 * 직함을 고르는 규칙 — **순수 함수만 둔다**
 *
 * **왜 파일을 갈랐나** (실측 2026-09-23)
 *
 * 이 규칙은 `member-title.ts` 안에 있었다. 그 파일에는 조직에서 값을 읽어 오는
 * `readOrgTitle` 도 같이 있고, 그것이 `lib/supabase/server.ts` 를 부른다.
 * 함수 안에서 `await import(...)` 로 늦게 부르는데도 **webpack 은 그 사슬을 그대로 따라간다.**
 * 그래서 화면 부품이 이 규칙을 쓰려는 순간 빌드가 깨졌다:
 *
 *   `next/headers` 는 서버 전용인데 클라이언트 번들에 들어왔다
 *   (Person.tsx → lib/ui/person.ts → member-title.ts → supabase/server.ts)
 *
 * 규칙은 화면도 쓰고 서버도 쓴다. 그래서 **읽는 일과 고르는 일을 나눈다** —
 * 여기는 값을 받아 고르기만 하고 아무것도 안 읽는다.
 * `member-title.ts` 가 이것을 다시 내보내므로 기존에 부르던 자리는 안 바뀐다.
 */

/** 조직에서 읽어 온 직함 조각 */
export interface OrgTitle {
  /** 직위 — 본부장·팀장·실장 */
  position: string | null
  /** 직급 — 상무·부장·차장 */
  rank: string | null
}

/**
 * 문서와 화면에 찍을 직함 하나를 고른다.
 *
 * 둘 다 있으면 **직위**를 쓴다 — 「본부장」이 「상무」보다 상대에게 역할을 알려 준다.
 * 직접 지정을 맨 앞에 두는 이유: 대외 문서에 다른 직함을 쓰는 경우가 실제로 있다
 * (겸직·대외 직함). 그때 조직 값이 덮어쓰면 고칠 방법이 없다.
 *
 * 아무것도 없으면 `''` 다. 「직원」처럼 지어내지 않는다.
 */
export function pickTitle(explicit: string | null | undefined, org: OrgTitle | null | undefined): string {
  const e = (explicit ?? '').trim()
  if (e) return e
  const p = (org?.position ?? '').trim()
  if (p) return p
  return (org?.rank ?? '').trim()
}
