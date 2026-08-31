'use client'

// 견적서 «종이» — 화면(상세)과 미리보기가 **같은 본문**을 쓴다
//
// **왜 나누나**: 인쇄·PDF·이미지는 미리보기(DocSurface)에서 나가고, 상세 화면도 같은 것을 보여 준다.
// 본문을 두 벌로 두면 한쪽만 고치는 날이 오고, 그날부터 **화면과 파일이 다른 문서**가 된다.
// 엑셀(`quote-xlsx.ts`)도 같은 `QuoteDocument` 를 읽는다 — 셋이 한 데이터에서 나온다.

import { Fragment } from 'react'
import EmptyState from '@/components/ui/EmptyState'
import { formatAmount } from '@/app/(crm)/crm/deals/amount'
import { QUOTE, SUPPLIER_ORDER, SUPPLIER_LABEL } from '@/lib/terms/quote'
import type { QuoteDocument, DocumentLine, DocumentSection } from '@/lib/crm/domain/quote-document'
import styles from './quote-document.module.css'

interface Props {
  doc: QuoteDocument
  /** 로고 data URI. 없으면 그 자리를 비운다 — 남의 로고를 대신 넣지 않는다 */
  logo: string
  /**
   * 어디에 얹히나.
   *
   * `screen` 은 앱 화면 안이라 카드 면을 갖고, `paper` 는 이미 흰 종이 위라 갖지 않는다 —
   * 둘 다 카드를 두면 **테두리가 겹치고 여백이 두 겹**이 된다(미리보기에서 보였다).
   */
  surface?: 'screen' | 'paper'
}

export default function QuoteSheet({ doc, logo, surface = 'screen' }: Props) {
  const money = (minor: string) => formatAmount(minor, doc.meta.currency) ?? '0'
  // 공급자는 «비어 있지 않은 것만» 줄을 만든다 — 「—」 가 늘어선 문서를 보내지 않는다
  const filled = SUPPLIER_ORDER.filter((f) => doc.supplier[f] !== '')

  /**
   * 묶음별로 항목을 나눈다.
   *
   * **묶음이 하나도 없으면 그룹 하나**(section=null)가 되어 예전과 똑같이 그려진다.
   * 묶이지 않은 항목은 묶음들 **뒤에** 따로 선다 — 앞에 두면 묶음의 첫 줄로 오해된다.
   */
  const groups: { key: string; section: DocumentSection | null; lines: DocumentLine[] }[] = (() => {
    if (doc.sections.length === 0) return [{ key: 'all', section: null, lines: [...doc.lines] }]
    type G = { key: string; section: DocumentSection | null; lines: DocumentLine[] }
    const out: G[] = doc.sections.map((sec): G => ({
      key: sec.id,
      section: sec,
      lines: doc.lines.filter((l) => l.sectionId === sec.id),
    }))
    const loose = doc.lines.filter((l) => !l.sectionId || !doc.sections.some((x) => x.id === l.sectionId))
    if (loose.length > 0) out.push({ key: 'loose', section: null, lines: loose })
    return out
  })()

  /**
   * 항목 한 줄. **묶음이 있든 없든 같은 함수가 그린다** —
   * 두 벌로 두면 묶음 있는 견적서와 없는 견적서가 서서히 다른 문서가 된다.
   */
  const renderLine = (l: DocumentLine) => (
                  <tr key={l.no}>
                    <td className={styles.center}>{l.no}</td>
                    {/*
                      **값은 원래 정렬을 지킨다.** 가운데로 바꾸는 것은 «제목(머리글)»뿐이다 —
                      금액을 가운데로 두면 자릿수가 세로로 안 맞아 크기를 눈으로 비교할 수 없다.
                    */}
                    <td>
                      <div className={styles.lineName}>{l.name}</div>
                      {l.spec && <div className={styles.spec}>{l.spec}</div>}
                    </td>
                    <td className={styles.center}>{l.unit ?? ''}</td>
                    <td className={styles.num}>{Number(l.quantity).toLocaleString('ko-KR')}</td>
                    <td className={styles.num}>{money(l.unitPriceMinor)}</td>
                    {/*
                      **특별가는 그 사실이 보여야 값이 있다.** 「80%」만 적으면 무엇에서
                      80% 인지 알 수 없다 — 정상가를 함께 적어야 고객이 혜택을 읽는다.
                    */}
                    <td className={styles.num}>
                      {/*
                        **둘 다 적는다.** 기본 할인은 늘 들어가는 것이고 특별 할인은 이번 건에만
                        주는 것이라, 하나만 적으면 고객은 나머지 하나를 못 본다
                        (사용자 지시: 「기본 할인과 특별할인이 다 붙어야지」).
                      */}
                      {l.isSpecialDiscount ? (
                        // 비율도 금액과 **같은 흐름**으로 읽힌다 — 기본에서 특별로 간다
                        <>
                          {/*
                            **태그는 흐름 밖이다.** 「특별 할인」 글자가 비율 옆에 붙으면
                            그 폭 때문에 「30% → 100%」가 두 줄로 접혀 화살표가 아무것도
                            가리키지 못했다(사용자 지적). 뜻은 아래 줄에서 말한다.
                          */}
                          <span className={styles.priceFlow}>
                            {l.baseDiscountPercent !== '0' && (
                              <>
                                <span className={styles.wasPct}>{l.baseDiscountPercent}%</span>
                                <span className={styles.srOnly}>에서</span>
                                <span className={styles.arrow} aria-hidden>→</span>
                              </>
                            )}
                            <span className={styles.special}>{l.specialDiscountPercent}%</span>
                          </span>
                          <div className={styles.specialTag}>{QUOTE.lineSpecialDiscount}</div>
                        </>
                      ) : (
                        l.discountPercent === '0' ? '' : `${l.discountPercent}%`
                      )}
                    </td>
                    <td className={styles.num}>
                      {/*
                        **「원래는 이만큼인데 이렇게 해 드립니다」가 한눈에 읽혀야 한다.**
                        위아래로 쌓으면 두 숫자가 각자 서 있을 뿐 관계가 안 보인다 —
                        화살표가 그 관계를 만든다(사용자 지시: 「이렇게 방향처럼 표시 해도 되고」).
                        화살표는 글자로 읽히지 않으므로 뜻은 sr 전용 글자로 따로 준다.
                      */}
                      {l.isSpecialDiscount && l.baseAmountMinor !== l.amountMinor ? (
                        <span className={styles.priceFlow}>
                          <span className={styles.wasAmount}>{money(l.baseAmountMinor)}</span>
                          <span className={styles.srOnly}>에서</span>
                          <span className={styles.arrow} aria-hidden>→</span>
                          <span className={styles.nowAmount}>{money(l.amountMinor)}</span>
                        </span>
                      ) : money(l.amountMinor)}
                    </td>
                  </tr>
  )

  return (
    <article className={surface === 'paper' ? styles.sheetBare : `card ${styles.sheet}`}>
      {/*
        상단 — 로고(좌)와 문서 메타(우)가 마주 본다.
        로고만 왼쪽에 두면 오른쪽이 비어 문서가 한쪽으로 쏠려 보인다.
      */}
      <header className={styles.topBar}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.logo} src={logo} alt={doc.supplier.name || QUOTE.logo} />
        ) : (
          <span />
        )}

        <dl className={styles.metaList}>
          <dt>{QUOTE.quoteNo}</dt><dd>{doc.meta.quoteNo}</dd>
          {doc.meta.issuedOn && (<><dt>{QUOTE.issuedOn}</dt><dd>{doc.meta.issuedOn}</dd></>)}
          {doc.meta.validUntil && (<><dt>{QUOTE.validUntil}</dt><dd>{doc.meta.validUntil}</dd></>)}
        </dl>
      </header>

      <h2 className={styles.docTitle}>{QUOTE.documentTitle}</h2>

      {/*
        두 당사자 — **같은 구조의 박스**다. 라벨 열 폭이 같아 값의 시작점이 나란하고,
        박스 높이도 맞춰 한쪽만 길어 보이지 않는다(세금계산서가 그렇게 생겼다).
      */}
      <div className={styles.parties}>
        <section className={styles.party}>
          <p className={styles.partyTitle}>{QUOTE.customer}</p>
          <p className={styles.partyName}>
            {doc.customer.companyName} {QUOTE.customerHonorific}
          </p>
          <dl className={styles.partyRows}>
            {doc.customer.personName && (
              <>
                <dt>{QUOTE.supplierContact}</dt>
                <dd>{doc.customer.personName}</dd>
              </>
            )}
            {/*
              무엇에 대한 견적인지 — 고객도 알아야 하는 정보다.
              이 칸이 비어 있으면 왼쪽 박스가 텅 비어 문서가 한쪽으로 기울어 보인다.
            */}
            <dt>{QUOTE.subject}</dt>
            <dd>{doc.meta.title}</dd>
          </dl>
        </section>

        <section className={styles.party}>
          <p className={styles.partyTitle}>{QUOTE.supplier}</p>
          {filled.length === 0 ? (
            /* 「—」 로 채우지 않는다. 비었으면 비었다고 말한다 */
            <p className={styles.spec}>{QUOTE.supplierMissing}</p>
          ) : (
            <>
              <p className={styles.partyName}>
            {doc.supplier.name}
            {/*
              날인 자리 — 도장 이미지 대신 문구. **상호 바로 옆**이 도장이 찍히던 자리다.
              전자로 보내는 문서에 도장을 박으면 받은 사람이 오려내 다른 문서에 쓸 수 있다.
            */}
            <span className={styles.sealOmitted}>{QUOTE.sealOmitted}</span>
          </p>
              <dl className={styles.partyRows}>
                {filled.filter((f) => f !== 'name').map((f) => (
                  <Fragment key={f}>
                    <dt>{SUPPLIER_LABEL[f]}</dt>
                    <dd>{doc.supplier[f]}</dd>
                  </Fragment>
                ))}
                {/*
                  담당은 **이 견적을 만든 사람**이다 — 회사 설정의 고정 연락처가 아니다.
                  고객이 이 번호로 걸면 그 사람이 받는다.
                */}
                {doc.owner.name && (
                  <>
                    <dt>{QUOTE.supplierContact}</dt>
                    <dd>
                      {doc.owner.name}{doc.owner.title ? ` ${doc.owner.title}` : ''}
                      {(doc.owner.phone || doc.owner.email) && (
                        <div className={styles.spec}>
                          {[doc.owner.phone, doc.owner.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </>
          )}
        </section>
      </div>

      {/*
        ── 합계 띠 ────────────────────────────────────────────
        **금액이 문서 맨 위에 한 번 더 온다.** 견적서를 받은 사람이 가장 먼저 찾는 것이
        「얼마인가」인데, 그게 항목표를 다 지나야 나오면 매번 스크롤해서 찾아야 한다.
        실무 견적서가 상단에 「일금 ○○○원정 (₩000,000)」을 두는 이유가 그것이다
        (사용자 지적: 「샘플 견적서 처럼 상단에 공급금액이 숫자와 한글로 표기되지 않는다」).

        한글과 숫자를 **함께** 적는 이유: 숫자만 있으면 자릿수를 고쳐 쓸 수 있고,
        한글만 있으면 읽기 어렵다. 둘이 서로를 검산한다.
      */}
      <div className={styles.amountBand}>
        <span className={styles.amountLabel}>{QUOTE.total}</span>
        <span className={styles.amountWords}>{doc.totals.totalInWords}</span>
        <span className={styles.amountFigure}>{money(doc.totals.totalMinor)}</span>
      </div>

      {doc.lines.length === 0 ? (
        <EmptyState title={QUOTE.noLines} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            {/* 열 폭을 여기서 정한다 — 내용이 정하게 두면 행마다 열이 흔들린다 */}
            {/*
              **폭은 비율로 준다.** rem 으로 고정했더니 A4 폭(210mm) 안에서 남는 칸이 눌려
              「gcube 크 / 레딧」처럼 품목 이름이 두 줄로 부서졌다 — 화면에서는 넓어 안 보이던 결함이
              미리보기(종이 폭)에서 드러났다. 비율이면 화면·종이 어디서든 같은 배치다.
            */}
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '15%' }} />
              {/*
                할인 칸은 **두 비율과 화살표가 한 줄에 서야** 한다. 8% 였을 때
                「30% →」 다음 줄로 「100%」가 접혀 화살표가 아무것도 가리키지 못했다
                (사용자 지적: 「퍼센트가 좀 가르켜야 하는데 지금은 줄바꿈이 되어 버렸네」).
              */}
              {/*
                실측으로 정한 값이다. 13% 였을 때 쓸 수 있는 폭이 73px 인데
                「30% → 100%」에 87px 이 필요해 14px 이 모자라 접혔다.
                16% 면 96px 이라 한 줄에 선다.
              */}
              <col style={{ width: '16%' }} />
              {/*
                합계(굵고 큰 글씨)가 들어갈 칸이라 항목 금액보다 넉넉해야 한다.
                21% 였을 때 「330,000,000원」의 **「원」이 잘렸다**(사용자 지적) —
                굵은 큰 글씨는 같은 자릿수라도 폭을 더 먹는다.
              */}
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr>
                {/* **제목만 가운데다**(사용자 지시). 값은 각자의 정렬을 지킨다 */}
                <th className={styles.center} scope="col">{QUOTE.lineNo}</th>
                <th className={styles.center} scope="col">{QUOTE.lineName}</th>
                <th className={styles.center} scope="col">{QUOTE.lineUnit}</th>
                <th className={styles.center} scope="col">{QUOTE.lineQuantity}</th>
                <th className={styles.center} scope="col">{QUOTE.lineUnitPrice}</th>
                <th className={styles.center} scope="col">{QUOTE.lineDiscount}</th>
                <th className={styles.center} scope="col">{QUOTE.lineAmount}</th>
              </tr>
            </thead>
            <tbody>
              {/*
                **묶음이 있으면 묶음 머리와 소계를 끼워 넣는다.**
                항목이 스무 줄 넘어가면 고객은 무엇이 무엇인지 모른 채 총액만 본다.
                묶음이 하나도 없으면 이 자리가 비어 예전과 똑같은 한 표가 된다.
              */}
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {g.section && (
                    <tr className={styles.sectionHead}>
                      <td colSpan={7}>{g.section.name}</td>
                    </tr>
                  )}
                  {g.lines.map((l) => renderLine(l))}
                  {g.section && g.lines.length > 0 && (
                    <tr className={styles.sectionSum}>
                      <td colSpan={6}>{g.section.name} {QUOTE.subtotal}</td>
                      <td className={styles.num}>{money(g.section.subtotalMinor)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>

            {/*
              합계는 **같은 표 안**이다. 밖에 두면 열 경계와 어긋나
              금액이 위아래로 안 맞는다(앞 판이 그랬다).
            */}
            <tfoot>
              {/* 라벨은 **두 칸에 걸친다** — 한 칸(할인 열)이면 「합계 금액」이 두 줄로 깨진다 */}
              <tr className={styles.firstTotal}>
                <td colSpan={4} />
                <td className={styles.totalLabel} colSpan={2}>{QUOTE.subtotal}</td>
                <td className={styles.num}>{money(doc.totals.subtotalMinor)}</td>
              </tr>
              <tr>
                <td colSpan={4} />
                <td className={styles.totalLabel} colSpan={2}>{QUOTE.discount}</td>
                <td className={styles.num}>
                  {doc.totals.discountMinor !== '0' && '− '}{money(doc.totals.discountMinor)}
                </td>
              </tr>
              {/*
                절사는 **할인과 줄을 나눈다.** 성격이 다르고, 합쳐 놓으면
                「할인 −86,437,000원」처럼 딱 안 떨어지는 숫자가 되어 고객이 계산을 하게 된다.
                절사가 없으면 줄 자체를 인쇄하지 않는다 — 빈 줄은 종이만 먹는다.
              */}
              {doc.totals.roundingMinor !== '0' && (
                <tr>
                  <td colSpan={4} />
                  <td className={styles.totalLabel} colSpan={2}>{QUOTE.rounding}</td>
                  <td className={styles.num}>− {money(doc.totals.roundingMinor)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={4} />
                <td className={styles.totalLabel} colSpan={2}>{QUOTE.tax}</td>
                <td className={styles.num}>{money(doc.totals.taxMinor)}</td>
              </tr>
              <tr className={styles.grand}>
                <td colSpan={4} />
                <td className={styles.totalLabel} colSpan={2}>{QUOTE.total}</td>
                <td className={styles.num}>{money(doc.totals.totalMinor)}</td>
              </tr>
              {/* 한글 금액은 위조 방지가 목적이라 총액 바로 아래 붙는다 */}
              {doc.totals.totalInWords && (
                <tr className={styles.inWords}>
                  <td colSpan={3} />
                  <td className={styles.num} colSpan={4}>{doc.totals.totalInWords}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      {doc.terms.length > 0 && (
        <section className={styles.terms}>
          <p className={styles.termsTitle}>{QUOTE.terms}</p>
          <ul className={styles.termsList}>
            {doc.terms.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </section>
      )}

      {doc.customerNote && (
        <section className={styles.terms}>
          <p className={styles.termsTitle}>{QUOTE.customerNote}</p>
          <p className={styles.note}>{doc.customerNote}</p>
        </section>
      )}
    </article>
  )
}
