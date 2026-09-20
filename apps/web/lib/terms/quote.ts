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
  /**
   * 규격 칸 안내 — **첫 줄이 규격, 아래가 구성**이라는 약속을 그 자리에서 말한다.
   * 말 안 하면 사람은 한 줄짜리 칸인 줄 알고 구성을 쉼표로 이어 붙인다.
   */
  lineSpecPlaceholder: '예: SXM5 · 3년 무상보증 (아래 줄에 구성을 한 줄씩)',
  /**
   * 규격 칸이 **어떻게 갈리는지**를 그 자리에서 보여 주는 줄.
   *
   * 「여러 줄로 적으세요」라고만 하면 사람은 적고 나서도 어디까지가 규격인지 모른다 —
   * 지금 적은 글이 몇 줄로 갈리는지 숫자로 보여 줘야 안다
   * (사용자 지적 2026-09-21: 「입력하는 곳에도 구분하는 방식에 대해 잘 넣고」).
   */
  lineSpecSplitHint: '첫 줄이 규격, 아래 줄부터 구성이에요',
  /*
    한 덩어리로 들어온 글을 줄로 나눠 굳히는 단추.

    파일에서 읽어 온 규격은 줄바꿈 없이 한 덩어리로 오는 일이 있다. 보이기만 갈라 두면
    저장본은 여전히 한 줄이라 다음에 고치는 사람이 또 한 덩어리를 본다 —
    누르면 **적힌 글 자체가** 줄로 나뉜다.
  */
  lineSpecSplitAction: '표식대로 줄 나누기',
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
   * 날인 자리 — **직인을 올렸으면 찍고, 안 올렸으면 이 문구가 대신 선다.**
   *
   * 오래 이 문구만 썼다. 직인 이미지를 파일에 박으면 받은 사람이 도장을 오려
   * 다른 문서에 붙일 수 있고, 그래서 전자 발송 문서에 「(직인생략)」이라고 적는 것이
   * 실무 관례이며 그 표기 자체가 «원본에는 날인이 있다»는 뜻으로 통용되기 때문이다.
   *
   * 다만 그건 **회사가 고를 일**이지 코드가 정할 일이 아니었다 — 관공서·입찰 서류처럼
   * 날인 없는 견적서를 안 받는 자리가 있다(사용자 지시 2026-09-21).
   * 그래서 설정에 직인 그림을 두고, 올린 회사는 찍고 안 올린 회사는 이 문구를 쓴다.
   */
  sealOmitted: '(직인생략)',
  /** 직인 그림 — 설정 이름이자 인쇄본의 대체 텍스트 */
  seal: '직인',

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

/**
 * 항목에 딸린 구성 줄을 접었다 편다.
 *
 * **줄 수를 먼저 말한다.** 「구성 보기」라고만 하면 몇 줄이 숨어 있는지 모르고,
 * 모르면 안 펴 본다 — 그러면 사라진 것과 접힌 것이 화면에서 똑같아진다.
 */
export function fillComponentsFold(lineCount: number, open: boolean): string {
  return open ? `구성 ${lineCount}줄 접기` : `구성 ${lineCount}줄 펴기`
}

/** 상한에 걸려 못 읽은 구성 줄 — 조용히 버리지 않는다 */
export function fillDroppedComponents(lineCount: number): string {
  return `구성 ${lineCount}줄은 상한에 걸려 못 읽었어요. 설정에서 상한을 올릴 수 있어요.`
}

/** 상한에 걸려 못 읽은 항목 */
export function fillDroppedLines(lineCount: number): string {
  return `항목 ${lineCount}개는 상한에 걸려 못 읽었어요. 설정에서 상한을 올릴 수 있어요.`
}

/**
 * 이 건이 원본 몇 쪽에서 왔는지.
 *
 * 한 파일에 견적이 둘이면 이 줄이 없을 때 사람이 원본을 열어 자기 건을 찾아야 한다
 * (사용자 지적 2026-09-20: 「거기 두개가 들어 있는데 찾아서 확인해야 하자나」).
 */
export function fillSourcePage(start: number | null, end: number | null): string | null {
  if (start === null) return null
  return end !== null && end !== start ? `원본 ${start}-${end}쪽` : `원본 ${start}쪽`
}

/** 지금 적은 글이 어떻게 갈리는지 — 숫자로 보여 준다 */
export function fillSpecSplit(componentCount: number): string {
  return componentCount > 0 ? `규격 1줄 · 구성 ${componentCount}줄` : '규격 1줄'
}


/** 표가 길어 뒤를 못 그렸을 때 — 조용히 자르지 않는다 */
export function fillSheetTruncated(rowCount: number): string {
  return `표가 길어 ${rowCount}줄은 화면에 안 그렸어요. 전체는 내려받아 보실 수 있어요.`
}

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
 * 한 파일에서 **몇 건을** 읽었는지 — 건이 둘 이상인 자리(딜 화면의 가져오기)용.
 *
 * **왜 따로 있나**(실측 v0.10.179): 견적 두 건이 든 파일을 올렸더니 머리말이
 * 「4개를 읽었어요」라고만 했다. 카드가 둘이니 세어 보면 알 수 있지만,
 * **몇 건인지가 이 기능의 요점**인데 그 숫자를 화면이 말하지 않은 것이다.
 * 사람은 「4개」를 보고 항목 넷짜리 견적 하나로 읽는다.
 *
 * 한 건이면 붙이지 않는다 — 「견적 1건」은 군말이고, 편집 모달은 어차피 한 건만 쓴다.
 */
export function fillFoundQuotesLine(quoteCount: number, lineCount: number, fileName: string): string {
  if (quoteCount <= 1) return fillFoundLine(lineCount, fileName)
  // 조수사는 개체표가 정한다 — 견적은 「건」, 품목은 「개」(둘 다 「건」이면 같은 것을 두 번 센 줄로 읽는다)
  return `${fileName} 에서 ${count('quote', quoteCount)} · ${count('product', lineCount)}를 읽었어요`
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

/*
  기다리는 동안 화면이 무슨 말을 할지 — **파일 읽기는 수 분이 걸린다.**

  창구 상한이 180초다(`app/api/crm/quotes/draft-file/route.ts`). 그 시간 동안 단추가
  「읽는 중…」 한 마디만 하고 있으면 사람은 그것을 진행이 아니라 **고장**으로 읽는다.
  회의노트가 v0.7.684 에 같은 지적을 받고 `lib/meeting/digest-progress.ts` 를 만들었고,
  미팅 끝내기가 2026-09-09 에 또 받고 그 모듈에 위임했다. 견적 쪽만 그 모듈을 못 보고 있었다
  (사용자 지적 2026-09-20: 「작업이 오래 걸리는 거는 사용자 눈에 정확하게 어떤 동작중인지
  보이게 하는게 있을텐데?」).

  문장은 여기 두고 계산은 `lib/crm/ui/quote-read-progress.ts` 가 한다 —
  말은 말 SSOT 에, 시간 분기는 순수 함수에.
*/

/** 아직 무엇을 읽는지 말할 거리가 없을 때 — 첫 몇 초 */
export const FILL_READ_START = '파일을 올리고 있어요'

/** 파일 이름을 모를 때 */
export const FILL_READ_UNNAMED = '올린 파일을 읽고 있어요'

/** 오래 걸리는 중 — 침묵은 고장으로 읽힌다 */
export const FILL_READ_LONG = '문서가 길어 나눠 읽고 있어요. 조금 더 걸립니다.'

/** 상한(180초)에 가까워지는 구간 */
export const FILL_READ_VERY_LONG = '거의 다 됐어요. 조금만 더 기다려 주세요.'

/**
 * 적어 준 글을 읽는 중 — **「올린 파일」이라고 하면 안 한 일을 했다고 말하는 것이다.**
 *
 * 회의노트가 같은 실수를 했다(v0.7.702: 녹음한 적 없는 회의에 「녹음을 읽고 있어요」).
 * 말로 채우기는 파일이 없다. 가진 것은 글자 수뿐이므로 그것만 말한다.
 */
export function fillReadingSaidLine(chars: number): string {
  if (chars <= 0) return '적어 주신 내용을 읽고 있어요'
  return `적어 주신 ${chars.toLocaleString()}자를 읽고 있어요`
}

/** 무엇을 읽는 중인지 — 이름과 크기는 **아는 것만** 말한다 */
export function fillReadingLine(fileName: string, bytes: number): string {
  const name = fileName.trim()
  if (name === '') return FILL_READ_UNNAMED
  const size = bytes > 0 ? `(${fileSizeLabel(bytes)})` : ''
  return `${name}${size} 을 읽고 있어요`
}

/** 「2.1MB」 · 「318KB」 — 사람이 올린 파일을 알아볼 만큼만 */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/**
 * 가져오는 중 — **건마다 따로 보내므로 몇 번째인지 말할 수 있다.**
 *
 * 경과 시간만 세는 것보다 낫다. 「3건 중 2건째」는 남은 일이 얼마인지까지 말한다.
 */
export function importProgressLine(done: number, total: number): string {
  if (total <= 1) return '견적을 만들고 있어요'
  return `${countOnly('quote', total)} 중 ${done + 1}건째를 만들고 있어요`
}

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
export const IMPORT_KEEP_FILE = '원본 파일도 함께 남기기'
export const IMPORT_KEEP_FILE_HINT =
  '만들어진 견적에 원본이 붙어, 제대로 읽혔는지 나중에 대조할 수 있어요. 원가로만 보내면 딜 첨부로 갑니다. 대외비로 올라가 관리자만 봅니다.'

/** 내용은 들어갔는데 파일만 못 올렸을 때 — 들어간 것까지 되돌리지 않는다 */
export const IMPORT_KEEP_FILE_FAILED =
  '원본 파일은 첨부하지 못했어요. 첨부 절에서 직접 올릴 수 있습니다.'

/*
  ── 출처와 대조 ────────────────────────────────────────────────

  **파일에서 읽은 견적은 「제대로 읽혔나」를 언젠가 반드시 묻는다.**
  그때 필요한 것은 두 가지다 — 어느 파일에서 왔는지, 그리고 그 파일을 지금 볼 수 있는지.

  그동안 앞의 것은 DB 에만 있었고 뒤의 것은 문서 맨 아래 내려받기 링크였다.
  사용자는 둘 다 없는 것으로 봤다(2026-09-20: 「원본 캡쳐되어서 대조 할 수 있는 기능이
  안보이는데」). 화면에 안 나오면 없는 것이다.
*/
export const QUOTE_SOURCE = {
  /** 「이 견적은 이 파일을 읽어서 만들었다」 */
  label: '읽어 온 파일',
  /**
   * 사람이 한 번도 안 고친 견적. **경고가 아니라 사실이다** —
   * 읽은 값이 이미 맞는 경우가 흔하고, 고치지 않기 위해 고치게 만들면 안 된다.
   */
  untouched: '읽은 값 그대로',

  // ── 대조 ──────────────────────────────────────────────
  /** 원본이 붙어 있을 때. 「원본 보기」가 아니다 — 보려는 것이 아니라 «견주려는» 것이다 */
  compare: '원본 대조',
  /** 대조 화면 제목 */
  compareTitle: '원본 대조',
  /** 왼쪽 칸 */
  paneOriginal: '원본',
  /** 오른쪽 칸. 「견적서」만으로는 둘 중 어느 쪽인지 모른다 */
  paneQuote: '읽어서 만든 견적서',
  /** 원본을 못 그리는 형식일 때 — 없는 척하지 않고 받아 보게 한다 */
  cannotDraw: '이 형식은 화면 안에 못 그려요',
  cannotDrawHint: '내려받아 여시면 같은 내용을 보실 수 있어요.',
  /** 원본을 못 불러왔을 때 */
  loadFailed: '원본을 불러오지 못했어요',
  /**
   * 오려 둔 조각을 보다가 **파일 전체**로 넘어가는 단추.
   *
   * 조각이 틀렸을 수도 있고 앞뒤 쪽이 궁금할 수도 있다 — 조각만 보여 주고 전체로 갈 길을
   * 막으면, 사람은 대조 화면을 닫고 첨부 목록으로 내려가야 한다.
   */
  showWhole: '파일 전체 보기',
  /** 전체를 보다가 다시 그 건의 쪽으로 */
  showCut: '이 건만 보기',
  /**
   * 엑셀 원본을 표로 펴서 보여 줄 때 — **우리가 읽은 결과가 아니라 그 파일**이라는 사실.
   *
   * 이 말이 없으면 사람은 왼쪽을 「시스템이 읽은 것」으로 오해하고, 그러면 대조가
   * 우리 해석끼리 견주는 일이 된다.
   */
  sheetNote: '원본 파일의 표를 그대로 폈어요',
  /** 시트가 여럿일 때 이름 앞에 붙는 말 */
  sheetName: '시트',
  /** 대조 화면에서 원본만 따로 받아 볼 때 */
  download: '원본 내려받기',

  // ── 원본이 없을 때 ────────────────────────────────────
  /**
   * 붙은 원본이 없는 견적에서 대조 단추 자리에 서는 것.
   *
   * **「첨부하기」가 아니다.** 첨부는 이 건에 딸린 아무 파일이나 두는 일이고,
   * 이것은 **견줄 상대**를 세우는 일이다 — 올리면 바로 대조 화면이 열린다.
   */
  upload: '원본 올리기',
  /**
   * 파일에서 읽은 견적인데 원본이 안 붙어 있다.
   *
   * 실제로 그런 견적이 있다(원본을 남기는 기능보다 먼저 만들어진 것). 아무 말도 안 하면
   * 사용자는 「대조 기능이 없다」로 읽는다 — 없는 것은 기능이 아니라 파일이다.
   */
  missing: '원본 파일이 안 붙어 있어요',
  missingHint: '올려 두시면 이 견적과 나란히 놓고 대조하실 수 있어요.',
} as const

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
 * `SupplierField` 와 분리한 이유: 로고와 직인은 문서의 «항목»이 아니라 그림이다.
 * 순서·라벨 표에 섞으면 「상호 · 사업자등록번호 · … · 로고」처럼 인쇄된다.
 * 키를 리터럴로 두는 이유는 위와 같다 — 배선 가드가 정적으로 찾을 수 있어야 한다.
 *
 * **직인은 안 올려도 된다.** 비어 있으면 `QUOTE.sealOmitted` 문구가 그 자리에 선다.
 */
export const SUPPLIER_IMAGE_KEY = {
  logo: 'quote.supplier.logo',
  seal: 'quote.supplier.seal',
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

/**
 * 견적서 파일 읽기 설정 키.
 *
 * **왜 따로 두나**: 위 둘은 「우리가 내는 견적서」의 값이고, 아래 다섯은
 * 「남이 준 견적서를 얼마나 읽을까」다. 성격이 달라 설정 화면에서도 카드가 갈린다.
 * 값을 푸는 곳은 `services/quote-import-config.ts` 한 곳이다.
 */
export const QUOTE_IMPORT_SETTING_KEY = {
  /** 항목 하나에 딸릴 구성 줄 수 상한 */
  maxComponentLines: 'quote.import.maxComponentLines',
  /** 한 건에서 받을 항목 수 상한 */
  maxLines: 'quote.import.maxLines',
  /** 모델에 넘길 원문 글자 수 상한 */
  maxChars: 'quote.import.maxChars',
  /** 건마다 그 쪽을 그림으로 굳혀 붙일까 */
  snapshot: 'quote.import.snapshot',
  /** 견적서 인쇄에서 구성을 펴나 접나 */
  printComponents: 'quote.print.components',
} as const

/** 문서에 찍히는 순서 — 세금계산서와 같은 순서다(사람이 눈으로 대조한다) */
export const SUPPLIER_ORDER: readonly SupplierField[] = [
  'name', 'bizNo', 'ceo', 'address', 'bizType', 'bizItem',
]
