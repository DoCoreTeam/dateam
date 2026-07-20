// 폼팩터 축 분리 SSOT(P5) — model_name 문자열에 섞인 폼팩터(SXM/PCIe/NVL)를 core와 분리해 매칭에 쓴다.
// 왜: gpu_products는 model_name·memory·gpu_count 3축뿐인데 실제 축은 모델·폼팩터·메모리·장수 4개.
//   "A100 SXM"·"H100 PCIe"·"B200 SXM6"·"H100 NVL"처럼 폼팩터가 model_name에 섞여 들어갔고,
//   동시에 "A100"·"B200"·"H100"처럼 폼팩터 없는 표기도 공존(카탈로그 표기 자체가 불일치).
//   경쟁사가 "A100 SXM4"·"H100 SXM5"·"GB200 SXM"처럼 세대숫자를 붙이면 문자열 전체일치가 깨져 매칭 실패 → resolve-product.ts가 held.
// ⚠️ RTX 6000 Ada·RTX PRO 6000처럼 폼팩터가 아닌 접미(세대명·라인명)는 절대 폼팩터로 오인하지 않는다(오제거 0).

export type FormFactor = 'SXM' | 'PCIe' | 'NVL'

// 세대숫자 없는 계열값만 허용(DB CHECK 제약과 동일 도메인). SXM4/SXM5/SXM6 등은 SXM으로 흡수.
const FORM_FACTOR_TOKEN = /^(SXM[0-9]*|PCI-?E|NVL)$/i

/** 폼팩터 토큰 정규화 — 대소문자·하이픈·세대숫자 변형 흡수. 매칭 불가 시 null. */
export function normalizeFormFactor(raw: string | null | undefined): FormFactor | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^SXM[0-9]*$/i.test(s)) return 'SXM'
  if (/^PCI-?E$/i.test(s)) return 'PCIe'
  if (/^NVL$/i.test(s)) return 'NVL'
  return null
}

export interface FormFactorExtract {
  /** 폼팩터 토큰을 뗀 나머지(모델 core). 폼팩터가 없으면 원본 그대로. */
  core: string
  formFactor: FormFactor | null
}

/**
 * 모델명 마지막 토큰이 폼팩터면 core와 분리. 마지막 토큰만 검사(RTX 6000 Ada / RTX PRO 6000의
 * "Ada"·"6000"은 FORM_FACTOR_TOKEN에 매칭되지 않아 오제거 0).
 * ⚠️ 메모리 토큰("80GB")이 뒤에 붙은 입력("H100 SXM5 80GB")은 호출부가 미리 정리해서 넘겨야 한다
 *   (canonicalizeModel()이 메모리·수량·벤더 노이즈를 제거한 뒤 폼팩터는 보존하도록 설계돼 있음 — resolve-product.ts 참조).
 */
export function extractFormFactor(modelName: string | null | undefined): FormFactorExtract {
  const s = (modelName ?? '').trim()
  if (!s) return { core: s, formFactor: null }
  const idx = s.lastIndexOf(' ')
  if (idx === -1) return { core: s, formFactor: null }
  const last = s.slice(idx + 1)
  if (!FORM_FACTOR_TOKEN.test(last)) return { core: s, formFactor: null }
  const formFactor = normalizeFormFactor(last)
  if (!formFactor) return { core: s, formFactor: null }
  return { core: s.slice(0, idx).trim(), formFactor }
}
