import { isDeepStrictEqual } from 'node:util'

export const destructiveSeedTestOptIn = 'PHOTO_NEXT_ALLOW_DESTRUCTIVE_ASSESSMENT_SEED_TESTS'

export const isDestructiveSeedTestEnabled = (
  environment: Readonly<Record<string, string | undefined>>,
) => environment[destructiveSeedTestOptIn] === '1'

type SeedTestBaseline = {
  activeRows: number
  actualManifest: unknown
  expectedManifest: unknown
  totalRows: number
}

export const assertCanonicalSeedTestBaseline = ({
  activeRows,
  actualManifest,
  expectedManifest,
  totalRows,
}: SeedTestBaseline) => {
  if (
    totalRows !== 28
    || activeRows !== 28
    || !isDeepStrictEqual(actualManifest, expectedManifest)
  ) {
    throw new Error('assessment seed test baseline is not the exact canonical catalog')
  }
}
