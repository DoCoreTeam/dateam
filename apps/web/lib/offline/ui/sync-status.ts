/**
 * 동기화 상태의 말과 색 — SSOT (용어집 §04)
 *
 * 모양은 `lib/crm/ui/meeting-status.ts` 를 그대로 따른다 —
 * `Record<Key, { label, status }>` + `_ORDER`. `status` 가 `StatusKey` 라
 * **색이 자동으로 따라온다**(화면이 색을 안 정한다).
 *
 * **말은 용어집이 정한 것만 쓴다.** 「올리지 못함」이지 「업로드 실패」가 아니고,
 * 「올리는 중…」은 진행 표기 규칙(공백 + 말줄임표)을 따른다.
 */

import type { StatusKey } from '../../tokens/status-colors.ts'
import { progress } from '../../terms/action.ts'

export type SyncStatusKey = 'OFFLINE' | 'UNREACHABLE' | 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED'

export const SYNC_STATUS_META: Record<SyncStatusKey, { label: string; status: StatusKey }> = {
  /** 연결이 없다 — **고장이 아니다.** 그 구분을 화면이 말해야 사람이 기다리지 않는다 */
  OFFLINE: { label: '연결 없음', status: 'note' },
  /**
   * 연결은 있는데 **우리 서버가 안 답한다** — 이쪽은 고장이다.
   *
   * 앞의 「연결 없음」과 갈라 두는 이유: 사람이 할 일이 다르다. 연결이 없으면 기다리면 되지만,
   * 서버가 안 답하면 기다려도 화면의 값은 낡아만 간다. 그리고 이 상태에서 보이는 화면은
   * **마지막으로 받은 것**이라 지금 누르는 것이 전부 실패한다(실측 2026-09-30).
   */
  UNREACHABLE: { label: '서버에 닿지 않음', status: 'blocker' },
  /** 기기에 있고 아직 안 올렸다 */
  QUEUED: { label: '대기', status: 'planned' },
  SYNCING: { label: progress('올리는'), status: 'doing' },
  SYNCED: { label: '올림 완료', status: 'done' },
  /** 올리기를 시도했고 실패했다 — **원본은 기기에 남아 있다** */
  FAILED: { label: '올리지 못함', status: 'blocker' },
}

/** 사람이 겪는 순서 — 끊기고 → 쌓이고 → 올라가고 → 끝나거나 실패한다 */
export const SYNC_STATUS_ORDER: SyncStatusKey[] = ['OFFLINE', 'UNREACHABLE', 'QUEUED', 'SYNCING', 'SYNCED', 'FAILED']
