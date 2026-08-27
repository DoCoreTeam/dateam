/**
 * 구 CRM(accounts·contacts·deals) 행의 수정·삭제 권한 판정 — SSOT
 *
 * 이 규칙은 우리가 지어낸 것이 아니라 **DB 의 RLS 정책 그대로**다(실측 v0.7.616):
 *   `accounts_update_own` · `accounts_delete_own` (contacts·deals 도 동일)
 *     = `auth.uid() = user_id  OR  profiles.role = 'admin'`
 *   `accounts_select_all` = 로그인한(삭제되지 않은) 사용자 전원
 *
 * 즉 **조회는 전원, 수정·삭제는 본인 또는 관리자**다.
 * 공개 API 는 서비스 롤로 돌아 RLS 를 우회하므로 같은 판정을 앱에서 다시 해야 한다.
 * 예전엔 이 검사가 **0건**이라 키 하나로 전원의 레코드를 고치고 지울 수 있었다.
 *
 * 목록 조회에 `user_id` 필터를 걸지 않는 것은 결함이 아니다 — RLS 가 원래 전원 조회를 허용한다.
 * 여기서 좁히면 화면(내부 API)보다 API 가 **덜** 보여 주게 되어 또 다른 불일치가 된다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { canMutateOwnedRow, forbiddenNotOwner, type ApiKeyContext } from '@/lib/publicApiAuth'
import { notFound } from './respond.ts'

/** 구 CRM 에서 소유권을 따지는 표 — 새 표를 늘리려면 RLS 를 먼저 확인한다 */
export type OwnedTable = 'accounts' | 'contacts' | 'deals'

/**
 * 이 행을 고치거나 지울 수 있는가.
 * 통과하면 `null`, 막히면 그대로 돌려보낼 응답을 반환한다.
 *
 * 없는 행과 남의 행을 **구분해서** 답한다 — 남의 행을 404 로 뭉개면
 * 사용자는 자기가 만든 것이 사라진 줄 안다.
 */
export async function guardOwnedRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: OwnedTable,
  id: string,
  ctx: ApiKeyContext,
  request: NextRequest,
): Promise<NextResponse | null> {
  const { data } = await admin.from(table).select('user_id').eq('id', id).maybeSingle()
  if (!data) return notFound({ ctx, request })
  if (!canMutateOwnedRow(ctx, data.user_id)) return forbiddenNotOwner(ctx, request)
  return null
}
