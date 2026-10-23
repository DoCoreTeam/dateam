/**
 * Exit codes and the error envelope. One table, so scripts and agents can branch on a number.
 */

export const EXIT = {
  OK: 0,
  /** Unexpected client-side failure, and network failure or timeout (no HTTP status to map) */
  UNKNOWN: 1,
  /** Usage error or a missing value, HTTP 400 and 422, and any other 4xx without its own row */
  USAGE: 2,
  /** HTTP 401 and 403, or no key */
  AUTH: 3,
  NOT_FOUND: 4,
  /** HTTP 409, version conflict */
  CONFLICT: 5,
  RATE_LIMITED: 6,
  /** HTTP 202, an approval request was created */
  APPROVAL_REQUIRED: 7,
  /** HTTP 5xx */
  SERVER: 8,
  /** Saved value differs from what was sent. Reserved: no command checks this yet */
  MISMATCH: 9,
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
  if (status === 401 || status === 403) return EXIT.AUTH
  if (status === 404) return EXIT.NOT_FOUND
  if (status === 409) return EXIT.CONFLICT
  if (status === 429) return EXIT.RATE_LIMITED
  if (status >= 500) return EXIT.SERVER
  if (status >= 400) return EXIT.USAGE
  return EXIT.UNKNOWN
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
