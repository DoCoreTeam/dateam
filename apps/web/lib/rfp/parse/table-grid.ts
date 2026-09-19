/**
 * 격자 하나를 **표의 세 모양**으로 (순수)
 *
 * ## 왜 떼어냈나
 *
 * 표를 만드는 코드가 오피스 파서 안에만 있었다. 글자 파일(마크다운·CSV)에도 표가 있는데
 * 그 파서는 문단만 만들어, 견적서를 마크다운으로 올리면 `| --- |` 구분줄까지 AI 에게
 * 글줄로 갔다(실측 2026-09-20: md·csv 의 tableCount 가 0).
 *
 * 그렇다고 셀 목록 만드는 두 겹 반복문과 표 HTML 을 저쪽에 복붙하면, 한쪽만 고쳐지는 날
 * **같은 문서가 형식에 따라 다른 표**가 된다. 표의 모양을 정하는 자리는 하나여야 한다.
 *
 * ## 여기서 하지 않는 것
 *
 * **찾지 않는다.** 어디부터 어디까지가 표인지는 형식마다 다르고(XML 노드·세로줄·콤마),
 * 그 판정은 각 파서의 일이다. 여기는 **이미 격자가 된 것**을 받는다.
 */

import type { IrTableCell } from '../ir/types.ts'

/** 격자의 열 수 — 가장 긴 행을 따른다. 짧은 행은 빈 칸으로 채워진다 */
export function gridCols(grid: readonly (readonly string[])[]): number {
  return grid.length === 0 ? 0 : Math.max(...grid.map((r) => r.length))
}

/**
 * 격자를 셀 목록으로.
 *
 * **빈 칸도 셀이다.** 없는 셀로 두면 읽는 쪽이 「없는 것」과 「빈 것」을 구분하지 못하고,
 * 열이 밀려 다음 열 값이 그 자리에 들어간 것처럼 보인다.
 * 병합(rowspan·colspan)은 여기서 만들지 않는다 — 격자는 이미 펴진 모양이다.
 */
export function gridToCells(grid: readonly (readonly string[])[], cols = gridCols(grid)): IrTableCell[] {
  const cells: IrTableCell[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ r, c, rowspan: 1, colspan: 1, text: grid[r][c] ?? '' })
    }
  }
  return cells
}

/** 표 블록의 글자 — 열은 탭, 행은 줄바꿈. 근거로 인용될 때 사람이 읽는 모양이다 */
export function gridToText(grid: readonly (readonly string[])[]): string {
  return grid.map((r) => r.join('\t')).join('\n')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 표 HTML — 열 수를 맞춰 빈 칸까지 그린다(줄이 밀려 보이지 않게) */
export function gridToHtml(grid: readonly (readonly string[])[], cols = gridCols(grid)): string {
  const body = grid
    .map((r) => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  return `<table>${body}</table>`
}
