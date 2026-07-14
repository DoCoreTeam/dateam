// 대화 → .docx 변환 (④ 다운로드 포맷 확장). 클라이언트 전용 — 브라우저 Blob/URL API 사용.
// docx 패키지(Packer.toBlob)로 Document를 만들어 즉시 다운로드한다. 서버 라우트 없음(요청서 §④ 명시).
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { formatKstDateTimeShort } from '../datetime/kst.ts'
import { htmlToPlain } from '../html-to-plain.ts'
import { sanitizeFilename, type ExportConversation, type ExportMessage } from './export.ts'

/** 순수 함수(테스트 대상): 대화 → docx Document. htmlToPlain으로 방어적 변환 후 줄 단위 Paragraph. */
export function buildConversationDocx(conv: ExportConversation, messages: ExportMessage[]): Document {
  const children: Paragraph[] = [
    new Paragraph({ text: conv.title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `provider: ${conv.provider} · model: ${conv.model} · ${formatKstDateTimeShort(conv.createdAt)}`,
          italics: true,
          color: '666666',
        }),
      ],
    }),
    new Paragraph({ text: '' }),
  ]

  for (const msg of messages) {
    children.push(
      new Paragraph({
        text: msg.role === 'user' ? '사용자' : '어시스턴트',
        heading: HeadingLevel.HEADING_3,
      }),
    )
    const plain = htmlToPlain(msg.content)
    for (const line of plain.split('\n')) {
      children.push(new Paragraph({ children: [new TextRun(line)] }))
    }
    if (msg.citations && msg.citations.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: '출처', bold: true })] }))
      msg.citations.forEach((c, idx) => {
        children.push(new Paragraph({ text: `${idx + 1}. ${c.title || c.url} (${c.url})` }))
      })
    }
    children.push(new Paragraph({ text: '' }))
  }

  return new Document({ sections: [{ children }] })
}

/** 대화를 .docx로 즉시 다운로드(브라우저 전용: Blob + a[download]). */
export async function downloadConversationDocx(
  conv: ExportConversation,
  messages: ExportMessage[],
): Promise<void> {
  const doc = buildConversationDocx(conv, messages)
  const blob = await Packer.toBlob(doc)
  const filename = `${sanitizeFilename(conv.title)}.docx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
