/**
 * 검색용 청크 만들기 (설계서 3.3.5)
 *
 * ## 왜 블록을 그대로 안 쓰나
 *
 * 블록은 «원문의 단위» 라 길이가 제각각이다. 한 글자짜리 문단과 3천 자짜리 표가 섞여 있으면
 * 임베딩이 **길이에 지배당한다** — 짧은 블록은 뜻이 흐리고, 긴 블록은 여러 주제가 섞여
 * 어느 질문에도 어중간하게 걸린다.
 *
 * ## 표는 행마다 자르되 제목을 붙인다
 *
 * 「12개월」 이라는 행만 떼면 그게 사업기간인지 하자보수기간인지 알 수 없다.
 * 표 제목과 머리글을 접두어로 붙여야 그 행 하나로도 뜻이 선다.
 *
 * ## 근거는 블록 ID 로 되돌아간다
 *
 * 청크는 검색용 사본이다. 화면이 인용할 때는 **청크가 아니라 블록**을 보여 준다.
 * 그래서 청크마다 어느 블록들에서 왔는지 남긴다.
 */

import type { IrDocument, IrBlock, IrTable } from '../ir/types.ts'
import { textHash } from '../ir/build.ts'

/** 청크 길이 — 너무 짧으면 뜻이 흐리고 너무 길면 주제가 섞인다 */
export const MIN_CHUNK_CHARS = 300
export const MAX_CHUNK_CHARS = 800
/** 앞 청크의 끝을 조금 물고 간다. 문장이 경계에서 잘려도 뜻이 이어지게 */
export const CHUNK_OVERLAP_CHARS = 80

export interface Chunk {
  /** 같은 내용이면 같은 키 — 다시 인덱싱해도 중복이 안 쌓인다 */
  chunkKey: string
  text: string
  /** 이 청크가 나온 블록들. 화면은 이걸 따라가 원문을 보여 준다 */
  blockIds: string[]
  sectionId: string | null
  pageNo: number | null
  kind: 'text' | 'table_row'
}

/**
 * 문서를 청크로 자른다.
 *
 * 문단은 이어 붙여 300~800자로 맞추고, 표는 행마다 자른다.
 * 표를 이어 붙이면 여러 요구사항이 한 청크에 섞여 「SFR-003 을 찾아 줘」가 안 걸린다.
 */
export function chunkDocument(doc: IrDocument): Chunk[] {
  const chunks: Chunk[] = []
  const tableById = new Map(doc.tables.map((t) => [t.blockId, t]))

  let buffer: IrBlock[] = []

  const flush = () => {
    if (buffer.length === 0) return
    chunks.push(...packText(buffer))
    buffer = []
  }

  for (const block of doc.blocks) {
    const table = tableById.get(block.blockId)
    if (table) {
      // 표를 만나면 앞의 문단 묶음을 먼저 닫는다. 안 그러면 표 앞뒤 문단이 한 청크에 붙는다
      flush()
      chunks.push(...packTable(block, table))
      continue
    }
    if (!block.text.trim()) continue
    buffer.push(block)
  }
  flush()

  return chunks
}

/** 문단들을 이어 붙여 길이를 맞춘다 */
function packText(blocks: readonly IrBlock[]): Chunk[] {
  const out: Chunk[] = []
  let text = ''
  let ids: string[] = []
  let sectionId: string | null = null
  let pageNo: number | null = null

  const close = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    out.push(makeChunk(trimmed, ids, sectionId, pageNo, 'text'))
    // 다음 청크가 앞의 끝을 조금 물고 간다
    const tail = trimmed.slice(-CHUNK_OVERLAP_CHARS)
    text = tail
    ids = ids.slice(-1)
  }

  for (const b of blocks) {
    const piece = b.text.trim()
    if (!piece) continue
    if (text && text.length + piece.length + 1 > MAX_CHUNK_CHARS) close()
    if (!text.trim()) { sectionId = b.sectionId; pageNo = b.pageNo }
    text = text ? `${text}\n${piece}` : piece
    if (!ids.includes(b.blockId)) ids.push(b.blockId)
    // 너무 긴 한 블록은 그 자체를 잘라야 한다
    while (text.length > MAX_CHUNK_CHARS) {
      const cut = text.slice(0, MAX_CHUNK_CHARS)
      out.push(makeChunk(cut.trim(), ids, sectionId, pageNo, 'text'))
      text = text.slice(MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS)
    }
  }

  const rest = text.trim()
  if (rest) {
    // 마지막 조각이 너무 짧으면 앞 청크에 붙인다 — 홀로 두면 뜻이 안 선다
    const last = out[out.length - 1]
    if (last && rest.length < MIN_CHUNK_CHARS && last.text.length + rest.length <= MAX_CHUNK_CHARS) {
      out[out.length - 1] = makeChunk(
        `${last.text}\n${rest}`.slice(0, MAX_CHUNK_CHARS),
        Array.from(new Set([...last.blockIds, ...ids])),
        last.sectionId, last.pageNo, 'text',
      )
    } else {
      out.push(makeChunk(rest, ids, sectionId, pageNo, 'text'))
    }
  }
  return out
}

/**
 * 표는 행마다 한 청크. 표 제목과 머리글을 접두어로 붙인다.
 *
 * 「12개월」 이라는 행만 떼면 사업기간인지 하자보수기간인지 알 수 없다.
 */
function packTable(block: IrBlock, table: IrTable): Chunk[] {
  const grid: string[][] = Array.from({ length: table.rows }, () => Array.from({ length: table.cols }, () => ''))
  for (const c of table.cells) {
    if (c.r < table.rows && c.c < table.cols) grid[c.r][c.c] = c.text.trim()
  }
  if (grid.length === 0) return []

  const caption = (table.caption ?? '').trim()
  const header = grid[0]
  const headerLine = header.filter(Boolean).join(' / ')
  // 표 제목이 없으면 머리글이 제목 노릇을 한다
  const prefix = [caption, headerLine].filter(Boolean).join(' — ')

  const out: Chunk[] = []
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]
    if (!cells.some(Boolean)) continue
    const body = header.map((h, c) => {
      const v = cells[c] ?? ''
      if (!v) return ''
      return h ? `${h}: ${v}` : v
    }).filter(Boolean).join(', ')
    if (!body) continue
    const text = prefix ? `${prefix}\n${body}` : body
    out.push(makeChunk(text.slice(0, MAX_CHUNK_CHARS), [block.blockId], block.sectionId, block.pageNo, 'table_row'))
  }

  // 머리글만 있고 본문 행이 없으면 표 전체를 한 청크로 둔다
  if (out.length === 0 && prefix) {
    out.push(makeChunk(prefix.slice(0, MAX_CHUNK_CHARS), [block.blockId], block.sectionId, block.pageNo, 'table_row'))
  }
  return out
}

function makeChunk(
  text: string, blockIds: string[], sectionId: string | null, pageNo: number | null,
  kind: Chunk['kind'],
): Chunk {
  return {
    // 내용으로 키를 만든다 — 다시 인덱싱해도 같은 내용은 같은 청크다
    chunkKey: textHash(`${kind}|${blockIds.join(',')}|${text}`).slice(0, 24),
    text,
    blockIds: Array.from(new Set(blockIds)),
    sectionId,
    pageNo,
    kind,
  }
}
