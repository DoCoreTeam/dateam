// 통합입력 첨부파일 → 전송경로 분류 SSOT (전송계층).
// UI(QuoteRegisterTab)와 서버(review/stream)가 함께 import — 종류 판별 복붙 금지(재사용·단일구현 정책).
// 참고: 추출"필드"→DB테이블 라우팅은 별 모듈 intake-routing.ts(다른 관심사). 본 파일은 "파일"→엔드포인트 라우팅.
// 순수함수 — DOM/네트워크 의존 없음(단위테스트 대상).

// 전송/용량 상한 (Vercel 서버리스 요청 본문 ~4.5MB 한도 — 안전 마진 포함)
export const INTAKE_LIMITS = {
  // stream(이미지/PDF) multipart 1파일 상한. raw 바이너리 기준(base64 인플레 없음).
  MAX_STREAM_FILE: 4 * 1024 * 1024,
  // catalog(xlsx/csv) multipart 상한 — 서버 catalog route와 동일(5MB).
  MAX_CATALOG_FILE: 5 * 1024 * 1024,
  // 이 크기 초과 이미지는 업로드 전 클라이언트 다운스케일.
  IMG_DOWNSCALE_OVER: 1.2 * 1024 * 1024,
} as const

// 단일 드롭존 accept 속성 — 모든 지원 형식.
export const ACCEPT_ALL = '.txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp,.pdf,.xlsx,.xls'

export type IntakeRoute = 'stream' | 'catalog' | 'text'
export type IntakeKind = 'image' | 'pdf' | 'spreadsheet' | 'text' | 'unknown'

export interface IntakeDecision {
  route: IntakeRoute
  kind: IntakeKind
  /** stream 경로에서 다운스케일 권장(이미지·상한초과 시 true) */
  shouldDownscale: boolean
  /** 경로 상한 초과 — UI는 업로드 차단 + 안내(무음 실패 금지) */
  tooLarge: boolean
  /** 경로별 상한(바이트) — 에러 메시지용 */
  maxBytes: number
}

interface FileLike {
  name: string
  type: string
  size: number
}

const hasExt = (name: string, exts: string[]): boolean => {
  const lower = name.toLowerCase()
  return exts.some((e) => lower.endsWith(e))
}

/**
 * 첨부 파일 → 전송경로 결정(SSOT).
 * - image/* | png·jpg·webp·gif → stream(image) [다운스케일 대상]
 * - application/pdf | *.pdf → stream(pdf)
 * - *.xlsx | *.xls → catalog(spreadsheet)
 * - text/* | *.csv|.txt|.md|.json → text (파일 내용을 textarea로 읽어들여 AI stream 분석)
 * - 그 외 → text 폴백 + kind 'unknown'(무음 실패 방지: 호출부가 안내 가능)
 */
export function classifyFile(file: FileLike): IntakeDecision {
  const type = (file.type || '').toLowerCase()
  const name = file.name || ''

  // 스프레드시트 — MIME가 비거나 제각각이라 확장자 우선.
  if (hasExt(name, ['.xlsx', '.xls']) ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      type === 'application/vnd.ms-excel') {
    return {
      route: 'catalog', kind: 'spreadsheet', shouldDownscale: false,
      tooLarge: file.size > INTAKE_LIMITS.MAX_CATALOG_FILE, maxBytes: INTAKE_LIMITS.MAX_CATALOG_FILE,
    }
  }

  if (type.startsWith('image/') || hasExt(name, ['.png', '.jpg', '.jpeg', '.webp', '.gif'])) {
    return {
      route: 'stream', kind: 'image',
      shouldDownscale: file.size > INTAKE_LIMITS.IMG_DOWNSCALE_OVER,
      tooLarge: false, // 이미지는 다운스케일로 사실상 항상 통과 — 차단 안 함
      maxBytes: INTAKE_LIMITS.MAX_STREAM_FILE,
    }
  }

  if (type === 'application/pdf' || hasExt(name, ['.pdf'])) {
    return {
      route: 'stream', kind: 'pdf', shouldDownscale: false,
      tooLarge: file.size > INTAKE_LIMITS.MAX_STREAM_FILE, maxBytes: INTAKE_LIMITS.MAX_STREAM_FILE,
    }
  }

  if (type.startsWith('text/') || hasExt(name, ['.csv', '.txt', '.md', '.json'])) {
    return { route: 'text', kind: 'text', shouldDownscale: false, tooLarge: false, maxBytes: INTAKE_LIMITS.MAX_STREAM_FILE }
  }

  return { route: 'text', kind: 'unknown', shouldDownscale: false, tooLarge: false, maxBytes: INTAKE_LIMITS.MAX_STREAM_FILE }
}

/** 바이트 → 사람이 읽는 MB 문자열(에러 메시지용). */
export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
