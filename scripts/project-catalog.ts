import { z } from 'zod'

export const projectDisplayTierSchema = z.enum(['current', 'experience'])
export const projectDisplayKindSchema = z.enum(['메인프로젝트', '최근사례', '짧은경험'])

export const projectCatalogRowSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
  year: z.number().int().min(2000).max(2100),
  title: z.string().trim().min(1).max(200),
  cancelled: z.boolean(),
}).passthrough()

export type ProjectCatalogRow = z.infer<typeof projectCatalogRowSchema>
export type ProjectCatalogEntry = ProjectCatalogRow & {
  readonly displayTier: z.infer<typeof projectDisplayTierSchema>
  readonly displayKind: z.infer<typeof projectDisplayKindSchema>
}

export const projectDisplayTierOf = (
  row: Pick<ProjectCatalogRow, 'year'>,
): z.infer<typeof projectDisplayTierSchema> => (
  row.year === 2026 ? 'current' : 'experience'
)

const projectDisplayKindOf = (
  row: Pick<ProjectCatalogRow, 'year'>,
): z.infer<typeof projectDisplayKindSchema> => {
  if (row.year === 2026) return '메인프로젝트'
  return row.year === 2025 ? '최근사례' : '짧은경험'
}

export const normalizeProjectCatalog = (
  rows: readonly ProjectCatalogRow[],
): readonly ProjectCatalogEntry[] => {
  const visible = rows
    .map(row => projectCatalogRowSchema.parse(row))
    .filter(row => !row.cancelled)

  const keys = new Set<string>()
  for (const row of visible) {
    if (keys.has(row.key)) throw new Error(`Duplicate project catalog key: ${row.key}`)
    keys.add(row.key)
  }

  return Object.freeze(visible.map(row => Object.freeze({
    ...row,
    displayTier: projectDisplayTierOf(row),
    displayKind: projectDisplayKindOf(row),
  })))
}
