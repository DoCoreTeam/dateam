// 서버 전용 문서 텍스트 추출 (officeparser). Node 전용('fs')이므로 클라이언트 번들에 섞이면 next build가 깨진다.
// attachments.ts는 Composer 등 클라이언트 컴포넌트가 import하므로, officeparser를 참조하는 이 함수는
// 반드시 여기(서버 라우트에서만 import되는 파일)에 격리한다. (세션2 회귀 수정)
import { DOCUMENT_TEXT_MIMES, DOCUMENT_OFFICE_MIMES, MAX_DOCUMENT_TEXT_CHARS } from './attachments.ts'

const OFFICE_PARSE_TIMEOUT_MS = 15_000 // office 텍스트 추출 하드 타임아웃(zip-bomb/과대 압축 DoS 방어)

function includesMime(list: readonly string[], mime: string): boolean {
  return list.includes(mime)
}

function truncateDocText(text: string): string {
  if (text.length > MAX_DOCUMENT_TEXT_CHARS) {
    return text.slice(0, MAX_DOCUMENT_TEXT_CHARS) + '[이하 절단]'
  }
  return text
}

// Promise에 하드 타임아웃 — 초과 시 reject(호출측이 400/폴백 처리)
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('extract timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// 서버 전용 — 텍스트 계열은 UTF-8 디코드(NUL 거부), office 3종은 officeparser 동적 import 추출.
// MAX_DOCUMENT_TEXT_CHARS 절단. 실패 시 throw(호출측이 400/폴백 처리).
export async function extractDocumentText(buf: Uint8Array, mime: string): Promise<string> {
  if (includesMime(DOCUMENT_TEXT_MIMES, mime)) {
    if (buf.includes(0)) throw new Error('문서에서 텍스트를 추출하지 못했습니다')
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      throw new Error('문서에서 텍스트를 추출하지 못했습니다')
    }
    return truncateDocText(text)
  }
  if (includesMime(DOCUMENT_OFFICE_MIMES, mime)) {
    // 동적 import — 순수 함수/테스트가 officeparser 설치를 요구하지 않도록 지연 로드.
    // officeparser v7 API: parseOffice(file) → AST → ast.to('md') → { value: string }.
    const { parseOffice } = await import('officeparser')
    let text: string
    try {
      // zip-bomb/과대 압축 DoS 방어 — parse+변환 전체를 하드 타임아웃(15s)으로 상한
      text = await withTimeout(
        (async () => {
          const ast = await parseOffice(Buffer.from(buf))
          const out = await ast.to('md')
          return typeof out?.value === 'string' ? out.value : String(out?.value ?? '')
        })(),
        OFFICE_PARSE_TIMEOUT_MS,
      )
    } catch {
      throw new Error('문서에서 텍스트를 추출하지 못했습니다')
    }
    return truncateDocText(text)
  }
  throw new Error('문서에서 텍스트를 추출하지 못했습니다')
}
