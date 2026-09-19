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

import { ENTITY, count, countOnly } from './entity.ts'

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
  /** 절사 — 「끝자리 정리」가 아니라 회계에서 쓰는 말 그대로 */
  rounding: '절사',
  discount: '할인',
  tax: '부가세',
  /**
   * 절사 **직전** 금액 = 공급가액 − 할인 + 부가세.
   *
   * 절사를 총액에 걸면서 생긴 줄이다. 이 줄이 없으면 부가세 다음에 갑자기
   * 합계가 줄어 있어 «어디서 빠진 거지»가 된다 — 「계 − 절사 = 합계」로 읽히게 한다.
   */
  netTotal: '계',
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
  /**
   * 항목을 **묶어서** 보여 주는 단위. 「섹션」·「그룹」이 아니라 「묶음」이다
   * (금지어: 외래어를 우리말로 바꿀 수 있으면 바꾼다).
   */
  addSection: '묶음 추가',
  /** 묶음에 안 넣은 항목을 고르는 값 */
  sectionNone: '묶지 않음',
  sectionLabel: '묶음',
  /**
   * 말로 적으면 항목으로 옮긴다. 「AI 로 만들기」라고 하지 않는다 —
   * **만드는 것은 사람**이고 이 단추는 받아 적기만 한다(§5-3).
   */
  fillBySpeech: '말로 채우기',
  /**
   * 이미 만들어 둔 견적서를 올려 우리 양식으로 옮긴다.
   * 「업로드」가 아니라 「채우기」다 — 파일을 **보관하는** 것이 아니라 **읽는** 것이다.
   */
  fillByFile: '파일로 채우기',
  /**
   * 딜 화면에서 견적서 파일을 올린다 — **여기서는 견적이 새로 생긴다.**
   * 편집 모달의 「파일로 채우기」와 말이 다른 이유: 저쪽은 보고 있는 견적의 **칸을 채우고**
   * 이쪽은 파일에 든 건마다 **어디로 보낼지 고른다**. 같은 말을 쓰면 결과가 다른데 같아 보인다.
   */
  importByFile: '파일로 가져오기',
  /** 파일 고르기 */
  fillPick: '파일 고르기',
  /** 읽은 것을 폼에 넣는다. 「저장」이 아니다 — 저장은 그다음이다 */
  fillApply: '체크한 항목 넣기',
  /** 말로 적은 것을 항목으로 */
  fillFromSpeech: '항목으로 옮기기',
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

// ------------------------------------------------------------
// 채우기 — 말과 파일, 두 길이 같은 말을 쓴다
// ------------------------------------------------------------

/*
  **왜 「저장은 하지 않아요」를 매번 말하나**: 이 기능은 AI 가 폼을 채운다.
  사람이 「AI 가 견적을 만들어 보냈다」고 오해하면 이 기능을 아예 안 쓴다.
  채우기는 **받아 적기**이고 저장은 사람이 누른다 — 그 사실을 화면이 말한다(§5-3).
*/

/** 말로 채우기 안내 */
export const FILL_SPEECH_HINT =
  '항목을 말하듯 적어 주세요. 품목·수량·단가·할인을 알아봅니다. 저장은 하지 않아요.'

export const FILL_SPEECH_PLACEHOLDER =
  '예) H100 SXM 2대 대당 5천만원, 3개월 구독, 기본 20% 할인\n     PM 1명 3 M/M, 만원 단위로 잘라 주세요'

/** 파일로 채우기 안내 */
export const FILL_FILE_HINT =
  '이미 만들어 둔 견적서를 올리면 항목으로 옮겨 드려요. 파일은 읽기만 하고 보관하지 않습니다.'

/** 무엇을 받는지 — 「모든 파일」이라고 하면 안 되는 것을 올리고 기다린다 */
export const FILL_FILE_KINDS = 'PDF · 엑셀 · 워드 · 한글 · 이미지'

/** 넣기 전에 반드시 보는 자리라는 사실 */
export const FILL_REVIEW_HINT =
  '읽은 항목이에요. 체크한 것만 폼에 들어갑니다. 원문과 견줘 보고 넣어 주세요.'

/** 못 알아본 말 — 버리지 않는다 */
export const FILL_UNCLEAR_TITLE = '이 부분은 못 알아봤어요. 직접 넣어 주세요'

/** 단가를 못 읽은 줄 — 0원으로 들어가면 안 되니 기본으로 체크를 뺀다 */
export const FILL_NO_PRICE = '단가를 못 읽었어요'

/** 원문 어디서 왔나 */
export const FILL_SOURCE_LABEL = '원문'

/** 표를 하나도 못 폈을 때 */
export const FILL_NO_TABLE =
  '표를 찾지 못해 글줄만 읽었어요. 항목이 빠졌을 수 있으니 원문과 꼭 견줘 주세요.'

/** 문서가 너무 길어 뒤를 못 읽었을 때 */
export const FILL_TRUNCATED =
  '문서가 길어 앞부분만 읽었어요. 뒤쪽 항목은 직접 넣어 주세요.'

/** 그림째 읽었을 때 — 글자를 «본» 것이라 더 틀릴 수 있다 */
export const FILL_READ_AS_IMAGE =
  '글자 레이어가 없어 그림으로 읽었어요. 숫자를 특히 꼼꼼히 봐 주세요.'

/** 파일에서 항목을 하나도 못 찾았을 때 */
export const FILL_NOTHING_FOUND =
  '견적 항목을 찾지 못했어요. 항목 표가 있는 쪽만 따로 올려 보세요.'

/**
 * 읽은 품목이 몇 개인지.
 *
 * **조수사를 손으로 적지 않는다**(개체표 §03: 품목은 「개」, 견적은 「건」).
 * 한 파일에서 견적을 여럿 읽으면 「견적 2건」과 「품목 12개」가 한 화면에 같이 선다 —
 * 둘 다 「건」이면 사람은 같은 것을 두 번 센 줄로 읽는다.
 */
export function fillFoundLine(lineCount: number, fileName: string): string {
  return `${fileName} 에서 ${countOnly('product', lineCount)}를 읽었어요`
}

/**
 * 한 파일에 견적이 둘 이상일 때 — **고르라고 한다.**
 *
 * 첫 건을 말없이 쓰면 사람은 나머지가 있었다는 사실 자체를 모른다.
 * 원가 견적서 한 장에 장비와 구축이 따로 적힌 경우가 그렇고, 그때 빠진 쪽은
 * 영영 안 들어간다 — 안 들어간 줄은 합계에서도 안 보인다.
 */
export function fillPickTitle(quoteCount: number, fileName: string): string {
  return `${fileName} 에서 ${countOnly('quote', quoteCount)}을 찾았어요. 채울 건을 골라 주세요`
}

/** 고르는 목록의 건 하나 — 문서가 이름을 안 줬으면 번호로 부른다 */
export function fillQuoteName(index: number, said: string | null): string {
  return (said ?? '').trim() || `${ENTITY.quote.label} ${index + 1}`
}

// ------------------------------------------------------------
// 가져오기 — 건마다 **어디로 보낼지** 사람이 정한다
// ------------------------------------------------------------

/*
  **왜 도착지를 묻나**: 받은 견적서 한 장이 무엇인지는 우리가 알 수 없다.
  원가일 수도 있고, 남의 견적에서 항목만 옮겨 오려는 것일 수도 있고, 그냥 참고일 수도 있다.
  «원가로 보인다»를 우리가 판정해 그쪽으로 밀면, 아닌 경우에 사람은 되돌리는 일부터 해야 한다.
  판정하지 않고 **묻는다** (사용자 지시 2026-09-19: "사용자에게 자율성을 줘").
*/

/** 가져오기 창의 제목 */
export const IMPORT_TITLE = '파일에서 견적 가져오기'

/** 아직 파일을 안 골랐을 때 */
export const IMPORT_FILE_HINT =
  '견적서를 올리면 그 안에 든 건마다 어디로 보낼지 고를 수 있어요. 파일은 읽기만 하고 보관하지 않습니다.'

/** 건 카드의 도착지 — **뜻이 다른 넷이라 라디오다**(고르면 하나만 된다) */
export const IMPORT_DEST = {
  new: '새 견적으로',
  append: '있는 견적에 붙이기',
  cost: '딜 원가로',
  skip: '안 씀',
} as const

export type ImportDestKey = keyof typeof IMPORT_DEST

/** 도착지마다 무슨 일이 일어나는지 — 고르기 전에 알아야 한다 */
export const IMPORT_DEST_HINT: Record<ImportDestKey, string> = {
  new: '이 건으로 견적을 하나 새로 만듭니다. 초안이라 언제든 고칠 수 있어요.',
  append: '고른 견적의 항목 뒤에 붙입니다. 있던 항목은 그대로 남아요.',
  cost: '판매 견적이 아니라 이 딜의 원가로 넣습니다.',
  skip: '이 건은 아무것도 하지 않습니다.',
}

/** 붙일 견적을 고르는 칸의 이름 */
export const IMPORT_APPEND_TARGET = '어느 견적에 붙일까요'

/** 붙일 수 있는 견적이 하나도 없을 때 — 왜 없는지까지 말한다 */
export const IMPORT_NO_APPEND_TARGET =
  '붙일 수 있는 견적이 없어요. 보낸 견적의 항목은 고칠 수 없어서 초안만 고를 수 있습니다.'

/** 건 카드를 펴고 접는 말 */
export const IMPORT_OPEN = '항목 보기'
export const IMPORT_CLOSE = '접기'

/** 만들기 단추 — 몇 건이 어디로 가는지 숫자로 말한다 */
export function importSubmitLabel(count: number): string {
  return count === 0 ? '가져올 건을 골라 주세요' : `${countOnly('quote', count)} 가져오기`
}

/** 끝난 뒤 — 무엇이 됐는지 건수로 말한다 */
export function importDoneLine(made: number, appended: number, costed = 0): string {
  const parts = [
    made > 0 ? `견적 ${made}건을 새로 만들었어요` : null,
    appended > 0 ? `${appended}건을 있는 견적에 붙였어요` : null,
    costed > 0 ? `${count('cost', costed)}을 넣었어요` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/*
  **원가 칸은 원가를 고른 사람에게만 보인다.**

  갈래·시점·마진은 원가로 보낼 때만 뜻이 있는 칸이다. 늘 세워 두면 새 견적 하나 만들려던
  사람이 안 쓰는 칸 셋을 지나쳐야 하고, 지나치는 칸은 결국 아무 값이나 남는다.
*/

/** 원가 도착지에서만 나타나는 칸들 */
export const IMPORT_COST_HINT =
  '이 건의 항목이 딜 원가로 들어갑니다. 원가는 견적서에 실리지 않고 관리자만 봅니다.'

/** 원가로 넣으면서 **같은 건으로** 판매 견적도 만들 수 있다 — 켜면 줄끼리 이어진다 */
export const IMPORT_COST_ALSO_QUOTE = '이 건으로 판매 견적도 함께 만들기'
export const IMPORT_COST_ALSO_QUOTE_HINT =
  '원가 줄과 판매 줄이 이어져 항목마다 얼마가 남는지 보입니다. 켜지 않으면 원가만 들어갑니다.'

/** 원가를 넣을 수 없는 사람에게 — **안 넣은 것이 아니라 못 넣는 것**임을 알린다 */
export const IMPORT_COST_ADMIN_ONLY = '원가는 관리자가 넣습니다.'

/*
  **근거 문서는 고른 사람만 남긴다.**

  올린 파일은 원래 보관하지 않는다(읽고 버린다). 그런데 원가로 넣고 나면
  「이 숫자 어디서 왔지」를 반드시 찾게 되므로, 그때만 남길지 묻는다. **기본은 꺼짐이다** —
  켜 두면 참고로 훑어본 남의 견적서까지 우리 저장소에 쌓인다.
*/
export const IMPORT_KEEP_FILE = '이 파일도 딜 첨부로 남기기'
export const IMPORT_KEEP_FILE_HINT =
  '원가가 어느 문서에서 나온 숫자인지 나중에 찾을 수 있어요. 대외비로 올라가 관리자만 봅니다.'

/** 원가는 들어갔는데 파일만 못 올렸을 때 — 들어간 것까지 되돌리지 않는다 */
export const IMPORT_KEEP_FILE_FAILED =
  '원가는 넣었지만 파일은 첨부하지 못했어요. 첨부 절에서 직접 올릴 수 있습니다.'

/*
  **판매가는 안 넣으면 안 바뀐다.**

  받은 견적서는 대개 남이 우리에게 파는 값이라 그대로 내보낼 수 없다. 그렇다고 기본
  마진율을 넣어 두면 그 숫자가 **검토 없이** 나간다 — 비워 두면 읽은 금액 그대로다.
*/

/** 이 건의 금액을 어떻게 할지 — 셋 중 하나다 */
export const IMPORT_PRICE = {
  keep: '읽은 금액 그대로',
  margin: '마진율 얹기',
  target: '목표 총액 맞추기',
} as const

export type ImportPriceKey = keyof typeof IMPORT_PRICE

export const IMPORT_PRICE_TITLE = '판매가'

export const IMPORT_PRICE_HINT: Record<ImportPriceKey, string> = {
  keep: '문서에 적힌 금액을 그대로 씁니다. 아무것도 더하지 않아요.',
  /*
    **마진율의 뜻을 여기서 못 박는다.** 「20%」가 원가에 곱하는 값인지 판매가에서 남는
    비율인지는 사람마다 다르게 읽는다 — 이 저장소의 마진율은 언제나 뒤쪽이다(원가 화면과 같은 뜻).
  */
  margin: '판매가에서 남는 비율이에요. 20 을 넣으면 100원짜리가 125원이 됩니다.',
  target: '항목 사이 비율은 그대로 두고 총액만 목표에 맞춥니다.',
}

/** 마진율 칸 — 이름은 원가 화면과 같은 말(`COST.marginPct`)을 쓴다 */
export const IMPORT_MARGIN_PLACEHOLDER = '비워 두면 그대로'

/** 목표 총액 칸 */
export const IMPORT_TARGET_TOTAL = '목표 총액'
export const IMPORT_TARGET_INCLUDES_TAX = '부가세 포함'

/*
  **일부만 실패했을 때 전부 실패한 것처럼 말하지 않는다.**

  건마다 따로 보내므로 셋 중 하나만 실패하는 일이 실제로 생긴다. 그때 「가져오지 못했습니다」
  한 마디만 띄우면 사람은 **하나도 안 들어간 줄 알고 다시 올린다** — 그러면 성공했던 둘이
  두 벌이 된다. 된 것과 안 된 것을 **둘 다** 말한다.
*/

/** 왜 안 됐는지조차 모를 때 — 그래도 「안 됐다」는 사실은 말한다 */
export const IMPORT_FAILED_UNKNOWN = '가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 파일을 못 읽었을 때 준비된 말 — 서버가 이유를 주면 **그 이유가 먼저다** */
export const FILL_READ_FAILED = '견적서를 읽지 못했습니다.'

/** 연결 자체가 안 될 때 문장에 들어가는 이름 */
export const FILL_FILE_LABEL = '견적서 파일'

/** 안 된 건 — 어느 건이 왜 안 됐는지. 이름이 없으면 몇 번째 건인지로 말한다 */
export function importFailedLine(fails: readonly { name: string; reason: string }[]): string {
  if (fails.length === 0) return ''
  const list = fails.map((f) => `${f.name}: ${f.reason}`).join(' · ')
  return `${countOnly('quote', fails.length)}은 못 가져왔어요. ${list}`
}

/** 된 것도 있고 안 된 것도 있을 때 — 한 줄로 이어 붙인다 */
export function importMixedLine(done: string, failed: string): string {
  return [done, failed].filter((x) => x.trim() !== '').join(' · ')
}

/** 도착지를 하나도 안 골랐을 때(전부 「안 씀」) */
export const IMPORT_NOTHING_PICKED =
  '보낼 곳을 고른 건이 없어요. 건마다 도착지를 골라 주세요.'

/** 고른 뒤에도 되돌아갈 수 있다 — 고르는 일은 되돌릴 수 있어야 한다 */
export const FILL_PICK_BACK = '다른 건 고르기'

/** 이 자리(편집 모달)는 견적 하나를 채운다 — 고른 것만 들어간다는 사실을 미리 말한다 */
export const FILL_PICK_ONE_ONLY =
  '여기서는 고른 한 건만 이 견적에 들어갑니다.'

// ------------------------------------------------------------
// 대조 — 「읽었다」와 「맞게 읽었다」는 다르다
// ------------------------------------------------------------

/*
  **왜 대조 결과를 말로 적나**: 숫자만 두면 사람은 그 숫자가 좋은 소식인지 나쁜 소식인지
  스스로 판단해야 한다. 차액 3,000만 원이 「빠뜨린 항목」인지 「반올림」인지는 우리가 이미 안다 —
  아는 것을 말하지 않고 숫자만 던지는 것은 판단을 떠넘기는 것이다.
*/

/** 줄 하나가 걸린 이유 */
export const FILL_RISK_TEXT = {
  no_price: '단가를 못 읽었어요',
  no_name: '품목 이름이 비었어요',
  amount_mismatch: '문서에 적힌 금액과 달라요',
  no_source: '원문을 못 찾아 대조하지 못했어요',
} as const

export type FillRiskKey = keyof typeof FILL_RISK_TEXT

/** 합계가 맞았을 때 — **맞았다는 사실도 말한다.** 말이 없으면 안 본 것과 같다 */
export const FILL_TOTAL_MATCH = '문서에 적힌 합계와 맞아요'

/** 문서에 합계가 없어 대조를 못 했을 때 */
export const FILL_TOTAL_NO_REFERENCE =
  '문서에서 합계를 찾지 못해 대조하지 못했어요. 금액을 직접 확인해 주세요.'

/**
 * 합계가 어긋났을 때 — **차액과 방향**을 함께 말한다.
 * 「다릅니다」만으로는 항목을 빠뜨린 건지 더 읽은 건지 알 수 없다.
 */
export function fillTotalMismatch(diffText: string, ourTotalIsLess: boolean): string {
  return ourTotalIsLess
    ? `읽은 금액이 문서 합계보다 ${diffText} 적어요. 빠진 항목이 있는지 봐 주세요.`
    : `읽은 금액이 문서 합계보다 ${diffText} 많아요. 합계 줄을 항목으로 읽었을 수 있어요.`
}

/** 우리 합계 / 문서 합계 라벨 */
export const FILL_TOTAL_OURS = '읽은 금액'
export const FILL_TOTAL_DOCUMENT = '문서 합계'

/**
 * 새 묶음의 기본 이름. 사람이 바로 고쳐 쓰라고 번호만 붙인다.
 *
 * 0 부터 세는 인덱스를 받는다 — 화면이 `length` 를 그대로 넘기면 «다음 번호» 가 된다.
 */
export function sectionDefaultName(index: number): string {
  return `${QUOTE.sectionLabel} ${index + 1}`
}

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
// 절사 — 「무엇에 맞추는가」를 말이 책임진다
// ------------------------------------------------------------

/*
  **왜 여기 있나**(사용자 지적 2026-09-08 · v0.7.698):
  「백만원 단위 버림」을 골랐는데 화면이 **「절사 − 600,000원」** 만 보여 줬다.
  60만원은 십만 자리 숫자라 *"백만단위 버림인데 왜 십만단위 버림이 되는건지?"* 가 나왔다.

  계산은 맞았다 — 303,600,000 을 백만원 단위로 버리면 303,000,000 이고, 이 값은
  뒤 여섯 자리가 0 이라 백만원 단위에 정확히 맞는다(십만원 단위였다면 이미 맞아서 절사가 0 원이다).
  **깎이는 금액은 단위 미만의 나머지**이지 단위와 같은 크기가 아니다.

  그런데 화면이 깎인 금액만 말하고 «무엇에 맞췄는지» 는 말하지 않으니,
  읽는 사람이 깎인 금액의 자릿수로 단위를 역산할 수밖에 없었다.
  그래서 **결과를 말로 붙인다** — 숫자 옆에 한 줄이면 오해가 성립하지 않는다.
*/

export type RoundingModeKey = 'DOWN' | 'NEAREST' | 'UP'

/**
 * 절사 단위에 붙는 이름.
 *
 * **값 목록은 여기 없다** — `quote-math.ts` 의 목록이 유일한 자리이고
 * (DB CHECK 와 같은 목록이다) 여기서는 그 값에 **이름만** 붙인다.
 * 두 벌로 두면 단위를 하나 늘릴 때 한쪽만 늘어, 화면에는 있는데 서버가 거부하는
 * 선택지가 생긴다.
 */
const UNIT_NAME: Record<number, string> = {
  1000: '천원',
  10000: '만원',
  100000: '십만원',
  1000000: '백만원',
  10000000: '천만원',
}

/** 단위 이름만 — 「백만원」. 「안 함」(0)·모르는 값은 null */
export function roundingUnitName(unit: number): string | null {
  return UNIT_NAME[unit] ?? null
}

/**
 * 선택지 라벨 — 「백만원 단위」. 0 은 「안 함」이다.
 *
 * **이 라벨만으로는 부족하다.** 「백만원 단위」는 ⓐ 백만원의 배수로 맞춘다
 * ⓑ 백만원 자리를 없앤다 **두 가지로 읽힌다**(사용자 지적 2026-09-08:
 * *"백만원 단위면 백만원 단위가 없어져야지 … 300,000,000이 되어야지"*).
 * 그래서 화면은 라벨 옆에 **결과 금액을 함께** 보여 준다 — 숫자를 보면 논쟁이 없다.
 */
export function roundingUnitLabel(unit: number): string {
  const name = roundingUnitName(unit)
  return name ? `${name} 단위` : '안 함'
}

export const ROUNDING_MODES: readonly { value: RoundingModeKey; label: string }[] = [
  { value: 'DOWN', label: '버림' },
  { value: 'NEAREST', label: '반올림' },
  { value: 'UP', label: '올림' },
] as const

/**
 * 절사가 **무엇을 했는지** 한 줄로. 고른 단위와 방식만 있으면 나온다.
 *
 * 금액은 이 문장에 넣지 않는다 — 바로 옆에 이미 숫자가 있고,
 * 두 번 적으면 둘이 어긋났을 때 어느 쪽이 진짜인지 알 수 없어진다.
 */
export function roundingNote(unit: number, mode: RoundingModeKey): string | null {
  const name = roundingUnitName(unit)
  if (!name) return null
  if (mode === 'UP') return `${name} 단위가 되도록 모자란 만큼 올렸어요.`
  if (mode === 'NEAREST') return `합계를 ${name} 단위로 반올림했어요.`
  return `${name} 미만을 버려서 합계가 ${name} 단위로 떨어져요.`
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
