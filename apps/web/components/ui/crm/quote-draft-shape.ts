/**
 * 견적 편집 폼이 다루는 **모양**과 그 모양을 만드는 함수들
 *
 * 편집 모달에서 떼어 낸 이유는 둘이다.
 *
 * ① **모달이 커졌다.** 파일로 채우기·검수가 붙으면서 한 파일이 1,100줄을 넘었고,
 *   그 안에서 «폼의 모양»과 «폼의 동작»이 섞여 있었다.
 * ② **모양을 아는 곳이 모달만이 아니다.** 견적서 보기 화면과 딜 상세 패널이
 *   `quoteToDraft` 를 부르려고 **화면 컴포넌트를 import** 하고 있었다 —
 *   모양을 알려고 화면을 끌어오면, 그 화면이 무거워질 때 같이 무거워진다.
 *
 * **여기에는 화면이 없다.** 타입과 순수 함수뿐이라 서버에서도 부를 수 있다.
 */

import { LINE_KIND_UNIT, type QuoteLineKind } from '@/lib/terms/cost'
import { computePeriod } from '@/lib/crm/domain/quote-rate'
import { todayPlus } from '@/components/ui/DateField'
// 규격·구성을 붙이고 가르는 규칙은 화면 밖에 둔다 — 부품 파일은 node --test 가 못 읽는다
export { joinSpec, splitSpec } from '@/lib/crm/domain/quote-spec'
// 산식도 같은 이유로 밖에 있다. 글 짓는 일은 quote-rate-text 한 곳이다
export { lineFormulaText } from '@/lib/crm/domain/quote-rate-text'
/*
  **금액 표시 신호 셋도 밖에 있다.** 「이 줄에 시간 축이 서나」는 문서 조립이 쓰는 규칙과
  같은 말이어야 하고(`quote-document` 의 hoursAxis), 여기 두면 실행기가 못 읽어 검산이 안 된다.
*/
export { sharedRatePeriod, anyRateHours, sharedRateHours, rateSectionApplies } from '@/lib/crm/domain/quote-rate'

/**
 * **시간으로 파는 종류.** 사용량은 시간당이 진짜 값이고 기간요금은 월 단가가
 * 진짜 값이라, 둘 다 기간에서 나머지 축을 세울 수 있다. 수량·공수·라이선스·비율
 * 줄에는 기간 칸도 금액 표시 자리도 서지 않는다 — 쓰지도 않을 것을 매번 지나쳐야 한다.
 */
const RATE_KINDS: readonly string[] = ['USAGE', 'PERIOD']

export function sellsByTime(kind: string | null | undefined): boolean {
  return RATE_KINDS.includes(kind ?? 'QUANTITY')
}

export interface QuoteLineDraft {
  id?: string | null
  /** 카탈로그의 어느 품목인지. 손으로 적기만 한 옛 항목은 null 이다 */
  productId?: string | null
  name: string
  /** 규격·설명 — 견적서에 품목 아래 작게 인쇄된다 */
  descriptionMd: string
  /**
   * 비고 — 견적서 표 맨 오른쪽 열.
   *
   * 규격과 다르다. **규격은 물건이 무엇인가**이고(「AMD EPYC 9355 32C/64T」),
   * **비고는 이 견적에서 그 줄이 무슨 구실인가**다(「서버 새시」「64코어」「Raid5」).
   */
  remark: string
  /**
   * 줄의 **종류** — 「수량 × 단가」가 뜻하는 것을 정한다.
   *
   * 같은 표에 「H100 2대」와 「PM 3 M/M」과 「유지보수 12개월」이 함께 서는데,
   * 라벨이 전부 「수량·단가」면 사람이 잘못 넣는다 — 실제로 M/M 을 「수량」 칸에 넣고
   * 단가를 월 단가로 적어 12배 틀린 견적이 나가는 사고가 이 업계의 고전이다.
   */
  kind: QuoteLineKind
  /** 공수 줄에서 «누가» — 「백엔드 개발자」 */
  roleLabel?: string
  quantity: string
  unit: string
  /**
   * **「얼마 동안」** — 수량과 함께 단가에 곱해진다(「17대 × 2개월」).
   *
   * 빈 문자열이면 «안 적음»이고 배수는 1 이다. 「1」을 기본값으로 박으면
   * 안 적은 줄에도 「× 1개월」이 인쇄된다.
   *
   * 날짜 칸과 다르다 — 날짜는 「언제」이고 이것은 「얼마나」다. 실측 2026-10-06:
   * 품목 164줄 가운데 날짜를 적은 줄이 0줄이었다(금액을 안 바꾸는 칸이라서).
   */
  durationValue?: string
  /** HOUR·DAY·MONTH·YEAR. 빈 문자열이면 «안 적음» — 값과 한 벌이다 */
  durationUnit?: string
  /**
   * 공급 기간(YYYY-MM-DD). **견적 유효기간과 다르다** — 유효기간은 「언제까지 이 값이
   * 유효한가」이고 이것은 「언제부터 언제까지 공급하는가」다. 여기서 개월과 총 시간을 센다.
   * 하나만 적어도 된다 — 끝이 협의 중인 견적이 실제로 있다.
   */
  startDate?: string
  endDate?: string
  unitPriceMinor: string
  discountPercent: string
  /** 특별 할인율(%) — **빈 문자열이면 «없음»** 이다. '0' 은 「0% 할인」이라 뜻이 다르다 */
  specialDiscountPercent?: string
  /** 몇 번째 묶음인가. null 이면 묶이지 않은 항목 */
  sectionIndex?: number | null
  taxRate: string
}

/** `/api/crm/products` 가 주는 모양 (금액은 BigInt 라 문자열로 온다) */
export interface ProductJson {
  id: string
  name: string
  sku: string | null
  unitPriceMinor: string
  currency: string
  taxRate: string
  unit: string | null
}

export interface QuoteDraft {
  id?: string
  version?: number
  title: string
  currency: string
  validUntil: string
  notesMd: string
  status?: string
  /**
   * 공급받는 곳의 담당자 — 「○○ 귀하」로 문서에 찍힌다.
   * **안 고르면 안 나온다.** 회사 앞으로만 보내는 견적이 흔하고,
   * 억지로 채우게 하면 아무나 골라 넣는다(사용자 지시).
   */
  recipientPersonId: string | null
  /**
   * 이 견적에 실을 거래 조건 — **고른 순서가 곧 인쇄 순서**다.
   * 통째로 적어 둔 한 덩어리가 아니라 항목이라, 사업마다 필요한 것만 나간다.
   */
  termIds: string[]
  /** 묶음. 비어 있으면 묶음 없는 견적이다 */
  sections: { id?: string | null; name: string }[]
  /** 절사 단위(원). 0 = 안 함 */
  roundingUnit: number
  /** DOWN(버림) · NEAREST(반올림) · UP(올림) */
  roundingMode: string
  /**
   * 금액 표시 — 무엇을 함께 인쇄할지. **합계는 이 선택으로 안 바뀐다.**
   * 비어 있으면 지금까지와 같은 견적서가 나온다.
   */
  rateAxisKeys: string[]
  lineNoteKeys: string[]
  totalConvKeys: string[]
  /** 월 기준 시간. 빈 문자열이면 설정 기본값(730) */
  rateHoursPerMonth: string
  lines: QuoteLineDraft[]
}

/**
 * 폼의 줄을 **서버가 받는 모양**으로.
 *
 * **왜 한 자리여야 하나**: 이 매핑은 편집 모달의 저장과 딜 화면의 「파일로 가져오기」가
 * 똑같이 한다. 두 벌이면 칸이 하나 늘 때 한쪽에만 붙고, 그 화면에서 넣은 값은
 * **저장하는 순간 조용히 사라진다** — 이 파일이 생긴 이유(quoteToDraft)와 같은 사고다.
 *
 * 이름이 빈 줄은 부르는 쪽이 먼저 걸러 낸다. 여기서 거르면 인덱스가 어긋난다.
 */
export function toLinePayload(l: QuoteLineDraft): Record<string, unknown> {
  return {
    id: l.id ?? null,
    // 카탈로그와의 연결 — 안 실으면 고른 품목이 저장 순간 다시 손으로 친 이름이 된다
    productId: l.productId ?? null,
    name: l.name.trim(),
    descriptionMd: l.descriptionMd.trim() || null,
    // 빈 칸은 «비고 없음» — 빈 글자로 저장하면 「적었는데 비었다」와 구별이 안 된다
    remark: l.remark.trim() || null,
    quantity: l.quantity || '1',
    unit: l.unit.trim() || null,
    /*
      **기간은 둘이 한 벌이다.** 한쪽만 채운 채 보내면 서버가 사람이 읽을 말로 거절한다 —
      여기서 조용히 한쪽을 지우면 사람은 적은 것이 사라진 줄 모른다.
      둘 다 비면 둘 다 null 이고, 그것이 「기간 없음」이다.
    */
    durationValue: (l.durationValue ?? '').trim() || null,
    durationUnit: (l.durationUnit ?? '').trim() || null,
    unitPriceMinor: l.unitPriceMinor || '0',
    discountPercent: l.discountPercent || '0',
    // 빈 칸은 «특별 할인 없음» — 0 으로 바꾸면 「0% 특별할인」이 되어 뜻이 달라진다
    specialDiscountPercent: l.specialDiscountPercent?.trim() ? l.specialDiscountPercent.trim() : null,
    taxRate: l.taxRate || '10',
    kind: l.kind ?? 'QUANTITY',
    roleLabel: (l.roleLabel ?? '').trim() || null,
    sectionIndex: typeof l.sectionIndex === 'number' ? l.sectionIndex : null,
    // 빈 칸은 «기간 없음» — 하나만 적어도 된다
    startDate: l.startDate?.trim() || null,
    endDate: l.endDate?.trim() || null,
  }
}

export function emptyLine(duration?: LineDuration | null): QuoteLineDraft {
  return {
    productId: null, name: '', descriptionMd: '', remark: '', kind: 'QUANTITY',
    quantity: '1', unit: LINE_KIND_UNIT.QUANTITY, unitPriceMinor: '', discountPercent: '0', taxRate: '10',
    /*
      기간은 **딜이 알면 그 값으로, 모르면 빈칸으로** 태어난다.
      1 을 박아 두면 딜 기간을 모르는 견적에도 「× 1개월」이 인쇄된다.
    */
    durationValue: duration?.value ?? '', durationUnit: duration?.unit ?? '',
  }
}

/** 새 품목이 들고 태어날 기간 — 딜의 시작일·종료일에서 센다 */
export interface LineDuration { value: string; unit: string }

export function newQuoteDraft(
  dealName: string,
  currency: string | null,
  validDays = 30,
  /**
   * 딜이 아는 기간 — 새 품목의 기간 칸에 미리 들어간다.
   *
   * **사람이 고친 값을 덮지 않는다.** 이 함수는 «새 초안»을 만들 때만 불리고,
   * 이미 만든 줄에는 손대지 않는다. 그래서 고쳐 둔 기간이 뒤에서 되돌아오지 않는다.
   */
  dealDuration?: LineDuration | null,
): QuoteDraft {
  return {
    title: `${dealName} 견적`,
    currency: (currency ?? 'KRW').toUpperCase(),
    // 빈 칸으로 두면 사용자가 연도부터 타이핑하게 되고, 거기서 6자리 연도가 들어간다.
    // **기본 일수는 설정에서 온다** — 예전엔 30이 여기 박혀 있어 바꾸려면 배포를 해야 했다.
    validUntil: todayPlus(validDays),
    notesMd: '',
    recipientPersonId: null,
    termIds: [],
    sections: [],
    // 새 견적은 절사 안 함 — 협상 결과이지 기본값이 아니다
    roundingUnit: 0,
    roundingMode: 'DOWN',
    // 새 견적은 금액 표시를 안 쓴다 — 켜는 것은 사람이 정할 일이다
    rateAxisKeys: [],
    lineNoteKeys: [],
    totalConvKeys: [],
    rateHoursPerMonth: '',
    lines: [emptyLine(dealDuration)],
  }
}

/**
 * 서버가 준 견적을 **편집 초안**으로.
 *
 * **왜 여기 있나**: 딜 상세(QuotePanel)와 견적 상세가 같은 모달을 여는데,
 * 이 변환을 각자 하면 한쪽에만 새 칸을 더하는 날이 온다 —
 * 그러면 그 화면에서 고친 값이 **저장하는 순간 조용히 사라진다**.
 * 모달이 쓰는 모양이니 모달이 정의한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quoteToDraft(body: any): QuoteDraft {
  return {
    id: body.id,
    version: body.version,
    title: body.title,
    currency: body.currency,
    validUntil: body.validUntil ? String(body.validUntil).slice(0, 10) : '',
    notesMd: body.notesMd ?? '',
    status: body.status,
    recipientPersonId: body.recipientPersonId ?? null,
    termIds: body.termIds ?? [],
    sections: (body.sections ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
    roundingUnit: Number(body.roundingUnit ?? 0),
    roundingMode: body.roundingMode ?? 'DOWN',
    // 안 들고 오면 고른 축이 저장하는 순간 사라진다 — 이 파일이 생긴 이유와 같은 사고다
    rateAxisKeys: body.rateAxisKeys ?? [],
    lineNoteKeys: body.lineNoteKeys ?? [],
    totalConvKeys: body.totalConvKeys ?? [],
    rateHoursPerMonth: body.rateHoursPerMonth == null ? '' : String(body.rateHoursPerMonth),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (body.lines ?? []).map((l: any) => ({
      id: l.id,
      // 카탈로그 연결을 들고 가지 않으면 저장하는 순간 손으로 친 이름으로 되돌아간다
      productId: l.productId ?? null,
      name: l.name,
      kind: (l.kind ?? 'QUANTITY') as QuoteLineKind,
      roleLabel: l.roleLabel ?? '',
      descriptionMd: l.descriptionMd ?? '',
      remark: l.remark ?? '',
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      /*
        **기간도 폼으로 돌려받는다.** 안 받으면 저장된 「2개월」이 편집 모달에서 빈칸으로
        보이고, 사람이 아무것도 안 고친 채 저장만 눌러도 그 줄의 금액이 절반이 된다.
        null 은 «안 적음»이라 빈 문자열이다 — String(null) 이 'null' 이 되면 안 된다.
      */
      durationValue: l.durationValue === null || l.durationValue === undefined ? '' : String(l.durationValue),
      durationUnit: l.durationUnit ?? '',
      startDate: l.startDate ? String(l.startDate).slice(0, 10) : '',
      endDate: l.endDate ? String(l.endDate).slice(0, 10) : '',
      unitPriceMinor: String(l.unitPriceMinor),
      discountPercent: String(l.discountPercent),
      // null 이면 «없음» 이므로 빈 문자열이다 — String(null) 이 '\uc5c6\uc74c' 이 아니라 'null' 이 되면 안 된다
      specialDiscountPercent: l.specialDiscountPercent === null || l.specialDiscountPercent === undefined
        ? '' : String(l.specialDiscountPercent),
      // 서버는 id 로 주고 화면은 인덱스로 다룬다 — 새 묶음은 아직 id 가 없기 때문이다
      sectionIndex: (() => {
        const idx = (body.sections ?? []).findIndex((x: { id: string }) => x.id === l.sectionId)
        return idx >= 0 ? idx : null
      })(),
      taxRate: String(l.taxRate),
    })),
  }
}
