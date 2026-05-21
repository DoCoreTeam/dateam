import {
  Document,
  Table,
  TableRow,
  TableCell,
  Paragraph,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  VerticalAlign,
  ShadingType,
} from 'docx'
import { parse } from 'node-html-parser'

export interface ReportRow {
  userName: string
  category: string
  performance: string
  plan: string
  issues: string
  weekStart: string
}

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
}

const FONT = '맑은 고딕'
const SIZE = 18 // 9pt in half-points

function htmlToParagraphs(html: string): Paragraph[] {
  const EMPTY = [new Paragraph({ children: [new TextRun({ text: '-', size: SIZE, font: FONT })] })]

  if (!html || html === '<p></p>' || html === '<p><br></p>' || html.trim() === '') return EMPTY

  const root = parse(html)
  const result: Paragraph[] = []

  function walk(node: ReturnType<typeof parse>): void {
    const tag = (node as any).tagName?.toLowerCase()

    if (tag === 'li') {
      const text = (node as any).text?.trim()
      if (text) {
        result.push(
          new Paragraph({
            children: [new TextRun({ text: '• ' + text, size: SIZE, font: FONT })],
            indent: { left: 180 },
          })
        )
      }
    } else if (tag === 'p') {
      const text = (node as any).text?.trim()
      if (text) {
        result.push(
          new Paragraph({
            children: [new TextRun({ text, size: SIZE, font: FONT })],
          })
        )
      }
    } else {
      for (const child of (node as any).childNodes ?? []) {
        walk(child)
      }
    }
  }

  for (const child of (root as any).childNodes ?? []) {
    walk(child)
  }

  return result.length > 0 ? result : EMPTY
}

function getDateRange(weekStart: string) {
  const start = new Date(weekStart)
  const perfEnd = new Date(start)
  perfEnd.setDate(start.getDate() + 4)

  const planStart = new Date(start)
  planStart.setDate(start.getDate() + 7)
  const planEnd = new Date(planStart)
  planEnd.setDate(planStart.getDate() + 4)

  const fmt = (d: Date) =>
    `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`

  return { perf: `${fmt(start)}~${fmt(perfEnd)}`, plan: `${fmt(planStart)}~${fmt(planEnd)}` }
}

function getISOWeek(date: Date): number {
  const tmp = new Date(date.getTime())
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
  const week1 = new Date(tmp.getFullYear(), 0, 4)
  return 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

export function buildDocx(reports: ReportRow[]): { doc: Document; filename: string } {
  const weekStart = reports[0]?.weekStart ?? new Date().toISOString().slice(0, 10)
  const { perf, plan } = getDateRange(weekStart)

  const d = new Date(weekStart)
  const weekNum = getISOWeek(d)
  const filename = `Weekly_DA_${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_week${weekNum}.docx`

  // 이름 기준으로 그룹화 (입력 순서 유지)
  const order: string[] = []
  const grouped: Record<string, ReportRow[]> = {}
  for (const r of reports) {
    if (!grouped[r.userName]) {
      grouped[r.userName] = []
      order.push(r.userName)
    }
    grouped[r.userName].push(r)
  }

  const headerCellStyle = {
    borders: BORDER,
    shading: { type: ShadingType.CLEAR, fill: 'D9D9D9' },
    verticalAlign: VerticalAlign.CENTER,
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        ...headerCellStyle,
        width: { size: 10, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '조직', bold: true, size: SIZE, font: FONT })] })],
      }),
      new TableCell({
        ...headerCellStyle,
        width: { size: 8, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '구분', bold: true, size: SIZE, font: FONT })] })],
      }),
      new TableCell({
        ...headerCellStyle,
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `성과 (${perf})`, bold: true, size: SIZE, font: FONT })] })],
      }),
      new TableCell({
        ...headerCellStyle,
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `계획(${plan})`, bold: true, size: SIZE, font: FONT })] })],
      }),
      new TableCell({
        ...headerCellStyle,
        width: { size: 26, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '이슈/협조사항', bold: true, size: SIZE, font: FONT })] })],
      }),
    ],
  })

  const dataRows: TableRow[] = []

  for (const name of order) {
    const rows = grouped[name]
    rows.forEach((row, idx) => {
      const cells: TableCell[] = []

      if (idx === 0) {
        cells.push(
          new TableCell({
            rowSpan: rows.length,
            borders: BORDER,
            verticalAlign: VerticalAlign.CENTER,
            shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: name, bold: true, size: SIZE, font: FONT })],
              }),
            ],
          })
        )
      }

      cells.push(
        new TableCell({
          borders: BORDER,
          verticalAlign: VerticalAlign.TOP,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: row.category, size: SIZE, font: FONT })],
            }),
          ],
        }),
        new TableCell({
          borders: BORDER,
          verticalAlign: VerticalAlign.TOP,
          children: htmlToParagraphs(row.performance),
        }),
        new TableCell({
          borders: BORDER,
          verticalAlign: VerticalAlign.TOP,
          children: htmlToParagraphs(row.plan),
        }),
        new TableCell({
          borders: BORDER,
          verticalAlign: VerticalAlign.TOP,
          children: htmlToParagraphs(row.issues),
        })
      )

      dataRows.push(new TableRow({ children: cells }))
    })
  }

  const table = new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })

  const doc = new Document({
    sections: [{ children: [table] }],
  })

  return { doc, filename }
}
