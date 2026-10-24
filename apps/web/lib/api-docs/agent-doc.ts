/**
 * 개발자센터 에이전트용 안내 절 (P0168)
 *
 * 화면(app/develop/AgentGuideSection.tsx)은 이 파일을 그리기만 한다
 *
 * 값의 출처
 *   경로 접두, 승인 요청 만료      gateway-doc.ts (원본 대조는 devcenter-docs.test.ts)
 *   기본 분당 한도                 lib/terms/devcenter.ts DEVCENTER_DEFAULT_RATE_LIMIT
 *                                  (lib/publicApiAuth.ts DEFAULT_RATE_LIMIT 는 내보내지 않고 서버 전용이라 가드가 대조한 이 값을 쓴다)
 *   명세 경로와 키 헤더            app/api/public/v1/openapi.json/route.ts (키를 요구한다, X-API-Key)
 *   승인 요청 상태 경로            registry.ts ref.approval (agent-doc.test.ts 가 대조)
 *   teamda help --json            packages/teamda-cli/src/run.ts
 * 상대 경로와 .ts 확장자로 적는다, 가드가 node --test 로 이 파일을 직접 읽는다
 */

import { API_APPROVAL } from '../terms/api-key.ts'
import { DEVCENTER_DEFAULT_RATE_LIMIT } from '../terms/devcenter.ts'
import { APPROVAL_EXPIRY_HOURS, GATEWAY_PREFIX } from './gateway-doc.ts'

/** 기계가 읽는 명세의 경로, 접두 뒤 */
export const AGENT_SPEC_PATH = `${GATEWAY_PREFIX}/openapi.json`
/** 승인 요청 상태를 묻는 경로, registry.ts ref.approval 과 같다 */
export const AGENT_APPROVAL_STATUS_PATH = `${GATEWAY_PREFIX}/approvals/{id}`
/** 명세를 받을 때 키를 싣는 헤더 */
export const AGENT_KEY_HEADER = 'X-API-Key'
/** 폴링이 분당 한도에서 쓸 몫, 나머지는 본 작업 몫 */
export const AGENT_POLL_SHARE = 0.5

const SECONDS_PER_MINUTE = 60

/** 분당 한도에서 폴링 간격(초)을 낸다: 한도의 AGENT_POLL_SHARE 만큼만 쓰도록 올림 */
export function pollIntervalSeconds(limitPerMinute: number = DEVCENTER_DEFAULT_RATE_LIMIT): number {
  const budget = Math.max(1, limitPerMinute * AGENT_POLL_SHARE)
  return Math.max(1, Math.ceil(SECONDS_PER_MINUTE / budget))
}

/** 명세를 받는 curl, 키 자리는 비워 둔다 */
export function agentSpecCurl(origin: string): string {
  return `curl -s "${origin}${AGENT_SPEC_PATH}" \\
  -H "${AGENT_KEY_HEADER}: <API 키>" \\
  -o openapi.json`
}

export const AGENT_CLI_HELP = 'teamda help --json'

/** 202 승인 흐름, dispatch.ts 의 202 응답과 approvals 경로의 동작 순서 */
export function buildApprovalFlow(limitPerMinute: number = DEVCENTER_DEFAULT_RATE_LIMIT): readonly string[] {
  return [
    '키 범위 밖의 쓰기를 보내면 게이트웨이는 실행하지 않고 202 와 approvalId, approvalUrl, expiresAt 을 돌려줍니다.',
    `사람이 웹의 approvalUrl 화면에서 「${API_APPROVAL.approve}」 또는 「${API_APPROVAL.reject}」를 누릅니다. 에이전트는 이 결정을 대신할 수 없습니다.`,
    `에이전트는 GET ${AGENT_APPROVAL_STATUS_PATH} 를 ${pollIntervalSeconds(limitPerMinute)}초 이상 간격으로 부르며 status 를 봅니다. PENDING 이면 계속 기다립니다.`,
    'APPROVED 가 오면 result 에 실행 결과의 HTTP 상태와 몸통이 실려 있습니다. 같은 요청을 다시 보내지 않습니다.',
    `REJECTED, EXPIRED, FAILED 면 실행되지 않았거나 실패한 것이므로 폴링을 멈춥니다. 결정이 없으면 ${APPROVAL_EXPIRY_HOURS}시간 뒤 EXPIRED 가 됩니다.`,
  ]
}

/** 화면 문구, 말투는 시작하기 절과 같다 */
export function buildAgentDoc(limitPerMinute: number = DEVCENTER_DEFAULT_RATE_LIMIT) {
  const interval = pollIntervalSeconds(limitPerMinute)
  const shareText = AGENT_POLL_SHARE === 0.5 ? '절반' : `${AGENT_POLL_SHARE * 100}퍼센트`
  return {
    nav: '에이전트용 안내',
    title: '에이전트용 안내',
    intro: 'AI 에이전트나 스크립트가 이 API 를 스스로 익히고 부를 때 필요한 것을 모았습니다.',
    specTitle: '기계가 읽는 명세',
    specBody:
      `전체 동작은 OpenAPI 3.1 명세 하나에 있습니다. 명세도 키를 요구하므로 ${AGENT_KEY_HEADER} 헤더를 실어 받습니다. 동작마다 CLI 명령(x-cli)과 필요한 범위(x-scope)가 함께 실립니다.`,
    approvalTitle: '승인이 필요한 쓰기',
    approvalBody: '키 범위 밖의 쓰기는 바로 실행되지 않고 사람의 승인을 기다립니다. 순서는 다음과 같습니다.',
    approvalSteps: buildApprovalFlow(limitPerMinute),
    cliTitle: 'CLI 를 쓰는 에이전트',
    cliBody:
      `${AGENT_CLI_HELP} 는 명령마다 cli, method, path, scope, summary 를 담은 JSON 하나를 냅니다. teamda help crm 처럼 앞 단어로 거를 수 있습니다.`,
    pollTitle: '알림과 폴링',
    webhookBody: '웹훅은 없습니다. 승인 결과나 작업 상태는 상태 경로를 다시 불러 확인합니다.',
    pollBody:
      `폴링은 키의 분당 한도(기본 ${limitPerMinute}회)의 ${shareText} 이하로 씁니다. 그래서 ${interval}초 이상 간격으로 부르기를 권합니다. 429 를 받으면 Retry-After 초만큼 기다립니다.`,
    pollIntervalSeconds: interval,
  } as const
}

export const AGENT_DOC = buildAgentDoc()

/** API 변경 내역 절의 문구 (줄은 api-changes.ts selectApiChanges 가 고른다) */
export const API_CHANGES_DOC = {
  nav: 'API 변경 내역',
  title: 'API 변경 내역',
  intro: '업데이트 내역 가운데 API 와 CLI 를 쓰는 쪽에 영향이 있는 줄만 최신 순으로 모았습니다.',
  empty: '아직 API 에 영향이 있는 변경이 없습니다.',
  versionPrefix: 'v',
} as const
