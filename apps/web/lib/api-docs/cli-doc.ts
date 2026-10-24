/**
 * 개발자센터 CLI 절의 설치와 설정과 종료 코드 (P0164 I03)
 *
 * 화면(app/develop/CliGuideSection.tsx)은 이 파일을 그리기만 한다
 * 명령 목록은 따로 CliSection 이 OpenAPI 생성물에서 그린다, 여기서는 그 위에 쓰는 법만 적는다
 *
 * 값의 출처
 *   종료 코드 이름과 숫자          packages/teamda-cli/src/exit.ts EXIT
 *   거절하는 키 인자              packages/teamda-cli/src/args.ts SECRET_FLAGS
 *   다시 시도 횟수               packages/teamda-cli/src/http.ts RATE_LIMIT_RETRIES, SERVER_RETRIES
 *   빌드 명령과 Windows 대상      packages/teamda-cli/package.json scripts
 *
 * teamda-cli 는 bun 패키지라 화면 묶음에 넣지 않는다
 *   그래서 여기 값을 두고 lib/api-docs/devcenter-docs.test.ts 가 원본을 직접 가져와 같은지 대조한다
 *   이름이나 숫자가 하나라도 갈리면 시험이 실패한다
 */

import { API_CLI_DOC } from '../terms/api-key.ts'

/** exit.ts EXIT 의 줄, 순서도 같다 */
export interface CliExitRow { name: string; code: number; desc: string }

export const CLI_EXIT_ROWS: readonly CliExitRow[] = [
  { name: 'OK', code: 0, desc: '성공' },
  { name: 'UNKNOWN', code: 1, desc: '예상하지 못한 클라이언트 오류, 네트워크 오류나 시간 초과(HTTP 상태가 없음)' },
  { name: 'USAGE', code: 2, desc: '알 수 없는 명령, 빠진 값, 명령줄 인자로 넘긴 키, HTTP 400 과 422, 따로 줄이 없는 그 밖의 4xx' },
  { name: 'AUTH', code: 3, desc: '키 없음, HTTP 401 과 403(범위가 모자란 경우 포함)' },
  { name: 'NOT_FOUND', code: 4, desc: 'HTTP 404' },
  { name: 'CONFLICT', code: 5, desc: 'HTTP 409, 버전 충돌' },
  { name: 'RATE_LIMITED', code: 6, desc: 'HTTP 429, 다시 시도한 뒤에도 한도에 걸림' },
  { name: 'APPROVAL_REQUIRED', code: 7, desc: 'HTTP 202, 승인 요청이 만들어짐(봉투에 approvalId)' },
  { name: 'SERVER', code: 8, desc: 'HTTP 5xx, 다시 시도한 뒤에도 실패' },
  { name: 'MISMATCH', code: 9, desc: '쓰기는 성공했지만 저장된 값이 보낸 값과 다름' },
]

/** args.ts SECRET_FLAGS, 이 이름의 인자는 다른 일보다 먼저 거절된다 */
export const CLI_SECRET_FLAGS: readonly string[] = ['key', 'api-key', 'apikey', 'token', 'secret', 'password']
/** http.ts RATE_LIMIT_RETRIES */
export const CLI_RATE_LIMIT_RETRIES = 3
/** http.ts SERVER_RETRIES */
export const CLI_SERVER_RETRIES = 1
/** package.json build:win 의 --target */
export const CLI_WINDOWS_TARGET = 'bun-windows-x64-baseline'
/** package.json engines.bun */
export const CLI_BUN_MIN = '1.1'

export const CLI_BUILD_SAMPLE = `cd packages/teamda-cli
pnpm build        # dist/teamda, 빌드하는 기계와 같은 운영체제와 CPU 용
pnpm build:win    # dist/teamda.exe, Windows x64 용`

export const cliConfigSample = (origin: string): string => `teamda config set base-url ${origin}
teamda config get`

export const CLI_LOGIN_SAMPLE = `teamda auth login --key-file ./teamda.key
cat ./teamda.key | teamda auth login --key-file -
teamda auth status
teamda auth logout`

export const CLI_SECRET_REFUSED_SAMPLE = `// teamda auth login --token ... 의 표준 오류, 종료 코드 2
{"error":{"code":"secret_on_argv","message":"--token is refused: pass the key with --key-file <path> or --key-file - (stdin), or TEAMDA_API_KEY"}}`

export const CLI_USE_SAMPLE = `teamda help crm
teamda sync
teamda crm quote get q_123
teamda crm company create --json @company.json --dry-run
teamda crm quote export q_123 --format pdf --out quote.pdf
teamda api GET crm/quotes --limit 5`

export const CLI_ERROR_SAMPLE = `// 표준 오류, 종료 코드 3
{"error":{"code":"forbidden","message":"이 작업에는 write 범위가 필요합니다.","status":403,"requiredScope":"write"}}`

export interface CliCommandRow { cmd: string; desc: string }

/** run.ts 가 OpenAPI 명령보다 먼저 받는 내장 명령, 첫 단어는 가드가 run.ts 에서 찾는다 */
export const CLI_COMMAND_ROWS: readonly CliCommandRow[] = [
  { cmd: 'teamda help', desc: '명령 목록을 글로 보입니다. --json 을 붙이면 명령마다 cli, method, path, scope, summary 를 담은 JSON 하나를 내고, teamda help crm 처럼 앞 단어로 거를 수 있습니다.' },
  { cmd: 'teamda sync', desc: '서버의 /api/public/v1/openapi.json 을 받아 내용이 바뀌었을 때만 저장합니다. 저장된 명세가 실행 파일에 든 명세보다 먼저 쓰입니다.' },
  { cmd: 'teamda api <METHOD> <path>', desc: '명령이 없는 호출을 그대로 보냅니다. /api/ 로 시작하지 않는 경로는 /api/public/v1 아래로 붙습니다.' },
  { cmd: 'teamda auth login --key-file <path>', desc: '키를 파일이나 표준 입력(--key-file -)에서 읽어 운영체제 자격 증명 저장소에 보관합니다. status 와 logout 도 있습니다.' },
  { cmd: 'teamda config set base-url <url>', desc: '부를 서버 주소를 저장합니다. config get 으로 지금 값을 봅니다.' },
  { cmd: 'teamda <명령> [--이름 값]', desc: `아래 ${API_CLI_DOC.nav} 목록의 명령입니다. --json 으로 본문을 넘기고, --dry-run 은 저장하지 않고 검사만 하며, --idempotency-key 는 Idempotency-Key 헤더가 됩니다.` },
]

export const CLI_DOC = {
  title: 'teamda CLI 시작하기',
  intro: 'teamda 는 공개 API 를 명령줄에서 부르는 클라이언트입니다. 명령은 손으로 적지 않고 OpenAPI 명세에서 만들어지므로 웹의 동작과 같은 이름을 씁니다.',

  buildTitle: '설치와 빌드',
  buildBody: `저장소의 packages/teamda-cli 폴더에서 빌드합니다. bun ${CLI_BUN_MIN} 이상이 필요하고, 명세가 들어간 실행 파일 하나가 dist 아래에 생겨 따로 설치할 것이 없습니다.`,
  buildTargets: `pnpm build 는 빌드하는 기계와 같은 운영체제와 CPU 용 실행 파일을 만듭니다. Apple 실리콘 Mac 같은 ARM 기계에서 빌드하면 ARM 용이 됩니다. pnpm build:win 은 ${CLI_WINDOWS_TARGET} 대상으로 빌드하므로 AVX 명령이 없는 x64 CPU 에서도 돕니다.`,

  configTitle: '서버 주소 설정',
  configBody: '처음 한 번 부를 서버의 주소를 저장합니다. 아래 명령에는 지금 보고 있는 화면의 주소가 들어 있습니다. TEAMDA_BASE_URL 환경 변수가 있으면 그 값이 먼저 쓰입니다.',

  loginTitle: '로그인',
  loginBody: '키는 파일이나 표준 입력으로만 받습니다. 키는 운영체제의 자격 증명 저장소에 보관되고 설정 파일에는 서버 주소만 남습니다. CI 에서는 TEAMDA_API_KEY 환경 변수를 씁니다.',
  loginRefused: `${CLI_SECRET_FLAGS.map((f) => `--${f}`).join(', ')} 처럼 키를 명령줄 인자로 넘기면 ps 와 셸 기록에 남기 때문에 다른 일을 하기 전에 종료 코드 2(secret_on_argv)로 거절합니다.`,

  commandsTitle: '기본 명령',
  commandHead: { cmd: '명령', desc: '설명' },
  useBody: '명령 단어 뒤의 값은 경로의 {id} 자리에 순서대로 들어갑니다. 나머지 인자는 GET 처럼 본문이 없는 호출이면 쿼리로, 그 밖에는 본문으로 보냅니다.',

  outputTitle: '출력 약속',
  outputBody: '성공하면 표준 출력에 JSON 값 하나만 내고 종료 코드 0 으로 끝납니다. 실패하면 표준 오류에 {"error":{...}} 봉투 하나를 내고 0 이 아닌 종료 코드로 끝납니다. 스크립트와 에이전트는 표준 출력을 그대로 JSON 으로 읽고 종료 코드로 갈래를 나누면 됩니다. 글로 내는 것은 --json 없는 teamda help 하나입니다.',
  outputFile: '파일 응답(PDF, 이미지)은 --out 경로에 받은 그대로 쓰고 표준 출력에는 file, bytes, contentType 을 담은 JSON 을 냅니다. --out 이 없으면 종료 코드 2(out_required)입니다.',
  outputRetry: `HTTP 429 는 Retry-After 만큼 기다렸다가 ${CLI_RATE_LIMIT_RETRIES}번까지, 5xx 는 ${CLI_SERVER_RETRIES}번 다시 시도합니다. 다시 시도할 때는 같은 본문과 같은 Idempotency-Key 를 보내고, 쓰기에 키를 주지 않으면 CLI 가 만들어 붙입니다.`,

  exitTitle: '종료 코드',
  exitBody: '종료 코드 표는 teamda 패키지가 EXIT 로 내보내는 표와 같습니다.',
  exitHead: { code: '코드', name: '이름', desc: '뜻' },
} as const
