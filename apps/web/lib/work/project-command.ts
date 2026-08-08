export type ProjectItemKind = 'milestone'|'task'|'risk'|'decision'
export interface ProjectCommand { action:'create'; kind:ProjectItemKind; title:string; status:'open' }
const RULES: Array<[ProjectItemKind, RegExp]> = [
  ['milestone', /^(?:마일스톤|이정표)\s*(?:추가|등록)?\s*[:：-]?\s*(.+)$/i],
  ['task', /^(?:할일|작업|업무)\s*(?:추가|등록)?\s*[:：-]?\s*(.+)$/i],
  ['risk', /^(?:리스크|위험)\s*(?:추가|등록)?\s*[:：-]?\s*(.+)$/i],
  ['decision', /^(?:결정|의사결정)\s*(?:추가|등록)?\s*[:：-]?\s*(.+)$/i],
]
export function parseProjectCommand(input:string): ProjectCommand | null {
  const text=input.trim().slice(0,500)
  for (const [kind,re] of RULES) { const match=text.match(re); if(match?.[1]?.trim()) return {action:'create',kind,title:match[1].trim(),status:'open'} }
  return null
}
