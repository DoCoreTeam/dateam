/**
 * 견적 용어 — 견적서라는 **문서**가 쓰는 말 (용어집 §2-3)
 *
 * **왜 장부(ledger.ts)와 따로 두나**: 장부는 «우리가 우리 숫자를 부르는 말»이고
 * 견적서는 «고객에게 나가는 말»이다. 둘은 같은 금액을 다르게 부른다 —
 * 우리는 「수주 매출」이라 하고 고객에게는 「합계 금액」이라 한다.
 * 한 파일에 섞으면 «어느 쪽 말인지» 판단을 화면이 하게 되고, 그때부터 갈린다.
 *
 * **여기 있는 말은 인쇄된다.** 오탈자가 고객에게 그대로 간다.
 * 그래서 화면이 문자열을 직접 적는 것을 특히 여기서 막는다.
 */

// ------------------------------------------------------------
// 문서의 자리 이름
// ------------------------------------------------------------

export const QUOTE = {
  /** 문서 제목 — 「견적서」가 표준이다. ~~「견적 의뢰서」~~ 는 반대 방향 문서다 */
  documentTitle: '견적서',

  // ── 두 당사자 ────────────────────────────────
  /** 우리 — 세금계산서·거래명세서와 같은 말을 쓴다 */
  supplier: '공급자',
  /** 고객 */
  customer: '공급받는자',
  /** 고객 회사명 뒤에 붙는 경칭 — 한국 견적서 관례 */
  customerHonorific: '귀중',

  // ── 공급자 항목 ──────────────────────────────
  supplierName: '상호',
  supplierBizNo: '사업자등록번호',
  supplierCeo: '대표자',
  supplierAddress: '주소',
  supplierBizType: '업태',
  supplierBizItem: '종목',
  /**
   * 담당 — **회사 설정이 아니라 견적을 만든 사람**이다(기획 결정 3).
   * 회사 설정에 고정 연락처를 두면 누가 만들었든 같은 번호가 찍히고,
   * 고객은 그 번호로 걸어 「누구 찾으세요?」를 듣는다.
   */
  /** 이 견적을 만든 사람. 「담당」만으로는 무엇의 담당인지 모른다 */
  supplierContact: '담당자',

  // ── 문서 메타 ────────────────────────────────
  quoteNo: '견적번호',
  issuedOn: '견적일',
  validUntil: '유효기간',
  currency: '통화',

  // ── 항목 표의 열 ─────────────────────────────
  lineNo: '번호',
  lineName: '품목',
  lineSpec: '규격·설명',
  lineUnit: '단위',
  lineQuantity: '수량',
  lineUnitPrice: '단가',
  lineDiscount: '할인',
  /** 기본 할인과 구분해서 부른다 — 「이번 건에만」이라는 뜻이 이름에 있어야 한다 */
  lineSpecialDiscount: '특별 할인',
  /** 특별가를 줬을 때 견적서가 말하는 원래 금액 */
  lineWasAmount: '정상가',
  lineAmount: '금액',

  // ── 합계 ─────────────────────────────────────
  subtotal: '공급가액',
  discount: '할인',
  tax: '부가세',
  total: '합계 금액',
  /** 한글 금액 — 위조를 막는 한국 견적서 관례 */
  totalInWords: '금액(한글)',

  // ── 조건 ─────────────────────────────────────
  terms: '거래 조건',
  paymentTerms: '결제 조건',
  deliveryTerms: '납품 조건',
  /** 고객이 보는 특기사항 */
  customerNote: '특기사항',

  // ── 편집 화면 ────────────────────────────────
  title: '제목',
  /**
   * 문서에 찍히는 이름. 편집 화면의 「제목」과 **같은 값이지만 다른 말**이다 —
   * 견적서·계약서에서는 「건명」이라고 부른다(~~「제목」~~ 은 우리끼리 쓰는 말).
   */
  /** 무슨 사업인지 — 「건명」은 관공서 서식 말이라 우리 문서에서는 「사업명」이다(사용자 지적) */
  subject: '사업명',
  /** 견적을 받는 쪽의 사람 — 「○○ 귀하」 */
  recipient: '받는 분',
  /** 미리보기 열기 — 내보내기는 전부 그 안에서 한다 */
  openPreview: '미리보기 · 내보내기',
  /** 그림 파일로. 메신저에 바로 붙일 수 있어야 한다 */
  exportImage: '이미지로 저장',
  /** 인쇄 대화상자를 거치지 않고 파일이 바로 떨어진다 */
  exportPdf: 'PDF로 저장',
  /** 고르지 않았을 때 — 「없음」이 아니라 «회사 앞으로만 간다»는 사실을 말한다 */
  recipientNone: '회사 앞으로만 (담당자 없이)',
  lines: '항목',
  addLine: '항목 추가',
  removeLine: '항목 삭제',
  /** 우리만 보는 메모 — 인쇄되지 않는다 */
  internalMemo: '내부 메모',
  preview: '미리보기',
  /**
   * 인쇄 대화상자를 연다. 거기서 「PDF 로 저장」을 고를 수 있는데,
   * 버튼이 「인쇄」라고만 하면 사용자는 **PDF 가 되는 줄 모른다** —
   * 실제로 견적서를 보낼 때 오가는 형식은 PDF 다.
   */
  /** 종이에 찍거나 다른 프린터로 보낼 때. PDF 파일은 exportPdf 가 따로 만든다 */
  print: '인쇄',
  exportXlsx: '엑셀로 내려받기',
  /** 로고 */
  logo: '로고',
  /**
   * 날인 자리. 이미지를 찍는 대신 **문구로 대체**한다.
   *
   * **왜 이미지가 아닌가**: 직인 이미지를 파일에 박아 보내면 그 파일을 받은 누구나
   * 도장을 오려내 다른 문서에 붙일 수 있다 — 견적서는 메일로 다시 전달되고 출력된다.
   * 그래서 실무에서는 전자 발송 문서에 「(직인생략)」이라고 적는 것이 관례이고,
   * 이 표기 자체가 «원본에는 날인이 있다»는 뜻으로 통용된다.
   */
  sealOmitted: '(직인생략)',

  // ── 상태·안내 ────────────────────────────────
  supplierMissing: '공급자 정보가 아직 없어요',
  noLines: '항목이 아직 없어요',
} as const

// ------------------------------------------------------------
// 문장 — 자리마다 문형이 정해져 있다(용어집 §0-2)
// ------------------------------------------------------------

/** 편집 화면의 제목. 새로 쓰는지 고치는지로 갈린다 */
export function quoteEditTitle(isEdit: boolean): string {
  return isEdit ? '견적 수정' : '새 견적'
}

/** 보낸 견적을 왜 못 고치는지 — 이유와 **다음 조치**를 함께 말한다 */
export const QUOTE_LINES_LOCKED =
  '이미 보낸 견적이라 항목은 수정할 수 없어요. 금액을 바꾸려면 새 견적을 만들어 주세요.'

/** 승인이 필요해진 이유 */
export function approvalNeeded(thresholdPct: number): string {
  return `할인율이 ${thresholdPct}%를 넘었어요. 저장은 되지만, 보내기 전에 승인을 받아야 합니다.`
}

/** 공급자 정보가 비었을 때 — **어디로 가면 되는지**까지 말한다 */
export const SUPPLIER_SETUP_HINT =
  '견적서에 우리 회사 정보가 비어 있어요. 설정 → 견적서 공급자 정보에서 채우면 모든 견적서에 함께 나갑니다.'

/** 내보낸 파일에 원가가 없다는 사실을 **미리** 알린다 */
export const EXPORT_SAFE_NOTE =
  '고객에게 나가는 파일이라 원가·마진은 담기지 않습니다.'

/** 인쇄 버튼 옆 — 무엇이 되는지 미리 말한다 */
export const PRINT_HINT =
  '인쇄 창에서 「PDF 로 저장」을 고르면 그대로 PDF 가 됩니다.'

/**
 * 금액이 어긋나 내보낼 수 없을 때 — **막힌 이유 옆에** 둔다.
 *
 * 오류를 누른 뒤에 알려 주면 사용자는 「왜 안 되지」를 두 번 겪는다.
 * 그리고 같은 문장을 두 군데(위반 배너 · 실패 배너)에 띄우면 중복으로 읽힌다.
 */
export const EXPORT_BLOCKED_NOTE =
  '이 상태로는 내보낼 수 없어요. 견적을 다시 저장하면 금액이 맞춰집니다.'

/** 유효기간이 지났을 때 */
export function expiredNote(dateText: string): string {
  return `유효기간(${dateText})이 지난 견적이에요. 보내려면 새 견적을 만들어 주세요.`
}

// ------------------------------------------------------------
// 한글 금액 — 「금 일억이천만원정」
// ------------------------------------------------------------

const DIGIT = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] as const
/** 만 단위 안의 자리 */
const SMALL_UNIT = ['', '십', '백', '천'] as const
/** 만 단위 묶음 */
const BIG_UNIT = ['', '만', '억', '조', '경'] as const

/**
 * 네 자리 이하를 한글로. `1010` → `일천일십`
 *
 * **1을 생략하지 않는다.** 「천만원」과 「일천만원」은 읽기엔 같지만,
 * 위조 방지가 목적인 표기에서 생략은 **글자를 끼워 넣을 자리**를 만든다.
 */
function underMyriad(n: number): string {
  let out = ''
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / 10 ** i) % 10
    if (d === 0) continue
    out += DIGIT[d] + SMALL_UNIT[i]
  }
  return out
}

/**
 * 금액을 한글로 — 견적서·계약서의 관례 표기.
 *
 * **왜 필요한가**: 숫자만 적힌 금액은 자릿수를 고쳐 쓰기 쉽다.
 * 그래서 한국의 금액 문서는 한글을 함께 적고, 앞에 「금」 뒤에 「정」을 붙여
 * **앞뒤로 글자를 덧붙이지 못하게** 막는다.
 *
 * 원 단위 통화가 아니면 관례가 다르므로 빈 문자열을 준다 —
 * 억지로 만들면 USD 견적에 「금 …원정」이 찍힌다.
 */
export function hangulAmount(minor: bigint | string | number, currency: string): string {
  if ((currency ?? '').toUpperCase() !== 'KRW') return ''
  let n = BigInt(minor)
  if (n < BigInt(0)) return ''
  if (n === BigInt(0)) return '금 영원정'

  const groups: string[] = []
  let unit = 0
  while (n > BigInt(0) && unit < BIG_UNIT.length) {
    const part = Number(n % BigInt(10000))
    if (part > 0) groups.unshift(underMyriad(part) + BIG_UNIT[unit])
    n /= BigInt(10000)
    unit += 1
  }
  return `금 ${groups.join('')}원정`
}

// ------------------------------------------------------------
// 공급자 정보 설정 키 — 설정 표와 문서가 같은 이름을 쓴다
// ------------------------------------------------------------

export type SupplierField =
  | 'name' | 'bizNo' | 'ceo' | 'address' | 'bizType' | 'bizItem' | 'terms'

/** 설정 키(`quote.supplier.*`) → 문서에 찍히는 라벨 */
export const SUPPLIER_LABEL: Record<SupplierField, string> = {
  name: QUOTE.supplierName,
  bizNo: QUOTE.supplierBizNo,
  ceo: QUOTE.supplierCeo,
  address: QUOTE.supplierAddress,
  bizType: QUOTE.supplierBizType,
  bizItem: QUOTE.supplierBizItem,
  terms: QUOTE.terms,
}

/**
 * 설정 키 — **리터럴로 적는다.**
 *
 * `quote.supplier.${f}` 처럼 조립하면 두 가지가 깨진다:
 *   ① 키가 설정 정의(SETTING_DEFS)와 읽는 코드 두 곳에 따로 적혀 어긋날 수 있다
 *   ② 「설정에 띄운 키는 읽는 코드가 있어야 한다」 가드가 **정적으로 못 찾는다**
 *      — 안 읽는 입력창을 막는 가드인데, 읽고 있는데도 «안 읽는다»고 잡는다.
 * 조립이 짧아 보여도 그 대가로 가드가 눈을 감는다.
 */
export const SUPPLIER_SETTING_KEY: Record<SupplierField, string> = {
  name: 'quote.supplier.name',
  bizNo: 'quote.supplier.bizNo',
  ceo: 'quote.supplier.ceo',
  address: 'quote.supplier.address',
  bizType: 'quote.supplier.bizType',
  bizItem: 'quote.supplier.bizItem',
  terms: 'quote.supplier.terms',
}

/**
 * 견적서에 찍히는 **이미지** 설정 키.
 *
 * `SupplierField` 와 분리한 이유: 로고는 문서의 «항목»이 아니라 그림이다.
 * 순서·라벨 표에 섞으면 「상호 · 사업자등록번호 · … · 로고」처럼 인쇄된다.
 * 키를 리터럴로 두는 이유는 위와 같다 — 배선 가드가 정적으로 찾을 수 있어야 한다.
 *
 * **직인은 여기 없다.** 이미지로 찍지 않고 `QUOTE.sealOmitted` 문구로 대체한다.
 */
export const SUPPLIER_IMAGE_KEY = {
  logo: 'quote.supplier.logo',
} as const

/**
 * 견적 자체의 설정 키.
 *
 * 공급자 정보(`quote.supplier.*`)와 나눈 이유: 이건 **우리 회사 정보가 아니라
 * 견적을 만드는 방식**이다. 한 묶음에 섞으면 「공급자 정보」 카드에
 * 유효기간이 끼어 무엇을 설정하는 카드인지 흐려진다.
 */
export const QUOTE_SETTING_KEY = {
  validDays: 'quote.validDays',
  /** 견적번호 형식 — 회사의 얼굴이라 배포 없이 바꿀 수 있어야 한다 */
  numberFormat: 'quote.numberFormat',
} as const

/** 문서에 찍히는 순서 — 세금계산서와 같은 순서다(사람이 눈으로 대조한다) */
export const SUPPLIER_ORDER: readonly SupplierField[] = [
  'name', 'bizNo', 'ceo', 'address', 'bizType', 'bizItem',
]
