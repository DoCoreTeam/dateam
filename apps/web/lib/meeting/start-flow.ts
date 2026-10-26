/**
 * 회의 시작 한 길 (SSOT)
 *
 * 사용자 지시 2026-10-26: 「녹음 시작」을 누르면 회의 시작과 똑같이 되어야 한다.
 * 회의와 회의노트를 만들고, 작업대를 메모(기록) 편집기가 보이게 열고, 녹음이 돌고 있어야 한다.
 *
 * 예전에는 입구마다 만드는 길과 가는 주소가 달랐다. 녹음 입구는 받아 적기 탭으로 열고
 * 녹음은 작업대에서 한 번 더 눌러야 켜졌다. 여기 한 곳에서 주소와 갈림을 정하고
 * 입구는 이 파일만 부른다.
 *
 * 녹음으로 들어가면 주소에 자동 녹음 표지(`rec=1`)를 단다. 작업대가 그 표지를 보고 한 번만 녹음을 켠다.
 */

import { meetingHref, startMeeting, type StartMeetingInput, type StartedMeeting } from '../crm/ui/start-meeting.ts'
import { beginRecording } from './begin-recording.ts'
import { ServerUnreachableError } from '../offline/reachable.ts'

/** 작업대가 도착하자마자 녹음을 켜라는 표지 */
export const AUTO_RECORD_PARAM = 'rec'
export const AUTO_RECORD_VALUE = '1'

export type StartEntry = 'record' | 'write' | 'paste'
export type StartTarget = 'crm' | 'notes'

/** 화면이 하는 말, 입구마다 따로 적지 않는다 */
export const START_MESSAGES = {
  notesFailed: '회의노트를 만들지 못해 녹음을 시작하지 않았어요. 연결을 확인하고 다시 눌러 주세요.',
  crmFailed: '미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
  offlineRecording: '연결이 없어 이 기기에 녹음하고 있어요. 연결되면 자동으로 올라갑니다.',
  offlineCannotWrite: '연결이 없어 작성 화면을 열 수 없어요. 지금은 녹음으로 남겨 주세요.',
} as const

/** 처음 보이는 탭, 붙여넣기만 받아 적기 탭이고 나머지는 메모 편집기 */
function workbenchTab(entry: StartEntry): string {
  return entry === 'paste' ? 'transcript' : 'memo'
}

export function startHref(target: StartTarget, id: string, entry: StartEntry): string {
  const base = target === 'crm' ? meetingHref(id) : `/meeting-notes/${id}`
  const rec = entry === 'record' ? `&${AUTO_RECORD_PARAM}=${AUTO_RECORD_VALUE}` : ''
  return `${base}?wb=${workbenchTab(entry)}${rec}`
}

export type StartNoteResult = { ok: true; id: string } | { ok: false; error: string }

export interface StartFlowInput extends StartMeetingInput {
  entry: StartEntry
  target?: StartTarget
}

export interface StartFlowDeps {
  /** 녹음 입구, 연결이 없으면 기기에 회의를 먼저 만든다 */
  begin?: typeof beginRecording
  /** 쓰기와 붙여넣기 입구, 서버에만 만든다. 기기에 남는 빈 회의를 만들지 않으려고 따로 둔다 */
  create?: (input: StartMeetingInput) => Promise<StartedMeeting>
  /** 회의노트 입구 */
  startNote?: () => Promise<StartNoteResult>
}

export type StartFlowOutcome =
  | { kind: 'navigate'; href: string; noteId: string }
  | { kind: 'local'; localId: string; title: string; startedAt: string }

function meetingInput(input: StartFlowInput): StartMeetingInput {
  return { dealId: input.dealId, companyId: input.companyId, dateKey: input.dateKey, now: input.now }
}

async function startNotes(input: StartFlowInput, deps: StartFlowDeps): Promise<StartFlowOutcome> {
  if (!deps.startNote) throw new Error(START_MESSAGES.notesFailed)
  const out = await deps.startNote().catch(() => null)
  if (!out) throw new Error(START_MESSAGES.notesFailed)
  if (!out.ok) throw new Error(out.error || START_MESSAGES.notesFailed)
  return { kind: 'navigate', href: startHref('notes', out.id, input.entry), noteId: out.id }
}

async function startWithoutRecording(input: StartFlowInput, deps: StartFlowDeps): Promise<StartFlowOutcome> {
  const create = deps.create ?? startMeeting
  try {
    const made = await create(meetingInput(input))
    return { kind: 'navigate', href: startHref('crm', made.id, input.entry), noteId: made.noteId }
  } catch (e) {
    // 쓰는 화면은 서버가 그려 준다. 못 여는 것을 여는 척하지 않는다
    if (e instanceof ServerUnreachableError) throw new Error(START_MESSAGES.offlineCannotWrite)
    throw e
  }
}

/** 실패하면 사람이 읽을 말로 던진다. 서버가 거절한 사유는 그대로 올린다 */
export async function runStartFlow(input: StartFlowInput, deps: StartFlowDeps = {}): Promise<StartFlowOutcome> {
  if ((input.target ?? 'crm') === 'notes') return startNotes(input, deps)
  if (input.entry !== 'record') return startWithoutRecording(input, deps)

  const begin = deps.begin ?? beginRecording
  const out = await begin(meetingInput(input))
  if (out.kind === 'server') {
    return { kind: 'navigate', href: startHref('crm', out.id, 'record'), noteId: out.noteId }
  }
  return { kind: 'local', localId: out.localId, title: out.title, startedAt: out.startedAt }
}
