/**
 * Exit codes and the error envelope. One table, so scripts and agents can branch on a number.
 */

export const EXIT = {
  OK: 0,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  APPROVAL_REQUIRED: 6,
  RATE_LIMITED: 7,
  SERVER: 8,
  NETWORK: 9,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

export interface ErrorBody {
  code: string
  message: string
  status?: number
  requiredScope?: string
  approvalId?: string
  candidates?: string[]
}

/** Thrown inside the CLI; main turns it into stderr JSON plus an exit code. */
export class CliError extends Error {
  readonly exit: ExitCode
  readonly body: ErrorBody
  constructor(exit: ExitCode, body: ErrorBody) {
    super(body.message)
    this.exit = exit
    this.body = body
  }
}

export function usage(code: string, message: string, extra: Partial<ErrorBody> = {}): CliError {
  return new CliError(EXIT.USAGE, { code, message, ...extra })
}

/** HTTP status to exit code. 202 is handled by the caller because it is not an error status. */
export function exitForStatus(status: number): ExitCode {
  if (status === 202) return EXIT.APPROVAL_REQUIRED
  if (status >= 200 && status < 300) return EXIT.OK
  if (status === 401) return EXIT.AUTH
  if (status === 403) return EXIT.FORBIDDEN
  if (status === 404) return EXIT.NOT_FOUND
  if (status === 429) return EXIT.RATE_LIMITED
  return EXIT.SERVER
}

const DEFAULT_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
}

export function defaultCodeForStatus(status: number): string {
  if (DEFAULT_CODE[status]) return DEFAULT_CODE[status]
  return status >= 500 ? 'server_error' : `http_${status}`
}
