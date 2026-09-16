/**
 * What an assistant is allowed to look at.
 *
 * ## Fields are allowed, rows are permitted, and those are different questions
 *
 * A catalog says which *fields* an assistant may read. Permission says which *rows* a person
 * may see. Answer only the first and the assistant reads a field it is allowed to read, on a
 * row the asker was never allowed to see.
 *
 * So reading requires both: a field the catalog opens, and a scope the caller supplies.
 * There is no way to read without a scope, because the moment there is one, somebody uses it.
 *
 * ## Closed by default
 *
 * A field is unreadable unless it says otherwise. Defaulting to open means every column added
 * later is readable the day it is added, and nobody decided that. Being told "this field is
 * not exposed" costs a code change; the other way costs a leak.
 */

export type Sensitivity = 'open' | 'internal' | 'secret'

export interface CatalogField {
  name: string
  /**
   * How freely this may be read.
   *
   * `open` reaches an assistant. `internal` needs an explicit unlock. `secret` never leaves,
   * unlock or not, because some values have no reading that is safe to paraphrase.
   */
  sensitivity: Sensitivity
  /** What it holds, so a reader can judge without opening the table */
  describes: string
}

export interface CatalogEntity {
  /** Must match an entity the caller's own glossary knows. This package never names things */
  key: string
  fields: readonly CatalogField[]
}

export interface Catalog {
  entities: readonly CatalogEntity[]
  /** Fields unlocked on purpose. Anything not listed stays closed */
  unlocked: readonly string[]
}

/** `entity.field`, the only way a field is addressed */
export function fieldPath(entity: string, field: string): string {
  return `${entity}.${field}`
}

/**
 * The scope a reader is allowed to see.
 *
 * There is no "all rows" value. A caller that genuinely has no restriction still has to say
 * so by listing what it owns, which keeps the decision visible at the call site.
 */
export interface ReadScope {
  /** Rows the asker may see, by whatever id the caller uses */
  allowedIds: readonly string[]
  /** Who is asking. Opaque here */
  actorId: string
}

export type ReadDenial =
  | { allowed: false; reason: 'unknown_entity' }
  | { allowed: false; reason: 'unknown_field' }
  | { allowed: false; reason: 'field_closed' }
  | { allowed: false; reason: 'field_secret' }
  | { allowed: false; reason: 'row_out_of_scope' }

export type ReadDecision = { allowed: true } | ReadDenial

/**
 * May this reader see this field on this row.
 *
 * Both halves are checked here rather than in two places, because two places is how one of
 * them ends up skipped.
 */
export function canRead(
  catalog: Catalog,
  entity: string,
  field: string,
  rowId: string,
  scope: ReadScope,
): ReadDecision {
  const e = catalog.entities.find((x) => x.key === entity)
  if (!e) return { allowed: false, reason: 'unknown_entity' }

  const f = e.fields.find((x) => x.name === field)
  if (!f) return { allowed: false, reason: 'unknown_field' }

  if (f.sensitivity === 'secret') return { allowed: false, reason: 'field_secret' }
  if (f.sensitivity === 'internal' && !catalog.unlocked.includes(fieldPath(entity, field))) {
    return { allowed: false, reason: 'field_closed' }
  }

  if (!scope.allowedIds.includes(rowId)) return { allowed: false, reason: 'row_out_of_scope' }
  return { allowed: true }
}

/** Every field an assistant may actually read, for building a prompt */
export function readableFields(catalog: Catalog, entity: string): CatalogField[] {
  const e = catalog.entities.find((x) => x.key === entity)
  if (!e) return []
  return e.fields.filter((f) => {
    if (f.sensitivity === 'secret') return false
    if (f.sensitivity === 'open') return true
    return catalog.unlocked.includes(fieldPath(entity, f.name))
  })
}

/** Unlocking something that is secret is a mistake, not a choice */
export function validateCatalog(catalog: Catalog): string[] {
  const problems: string[] = []
  for (const path of catalog.unlocked) {
    const [entity, field] = path.split('.')
    const e = catalog.entities.find((x) => x.key === entity)
    if (!e) { problems.push(`unlocked path names an unknown entity: ${path}`); continue }
    const f = e.fields.find((x) => x.name === field)
    if (!f) { problems.push(`unlocked path names an unknown field: ${path}`); continue }
    if (f.sensitivity === 'secret') problems.push(`a secret field cannot be unlocked: ${path}`)
    if (f.sensitivity === 'open') problems.push(`an open field does not need unlocking: ${path}`)
  }
  for (const e of catalog.entities) {
    for (const f of e.fields) {
      if (!f.describes.trim()) problems.push(`field says nothing about itself: ${fieldPath(e.key, f.name)}`)
    }
  }
  return problems
}
