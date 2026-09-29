/** Pure checks for the Dolusoft fork release flow; kept free of I/O so they can be unit tested. */

// <major>.<minor>.<patch>-[<prerelease>.]dolusoft.<n>, n >= 1. The prerelease suffix is mandatory so a
// fork build always sorts below the next upstream stable release (and, on a prerelease base such as
// 2.0.0-beta.0, below the next upstream prerelease 2.0.0-beta.1) while sorting above its own base.
const VERSION_PATTERN = /^\d+\.\d+\.\d+-(?:[0-9A-Za-z-]+\.)*dolusoft\.[1-9]\d*$/u

export const REQUIRED_PACKED_FILES: readonly string[] = [
  'package/package.json',
  'package/LICENSE.md',
  'package/es/index.mjs',
  'package/lib/index.cjs',
  'package/dist/index.d.ts',
  'package/dist/style.css',
]

export function assertDolusoftVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `Version "${version}" does not match <upstream>-[<prerelease>.]dolusoft.<n> (n >= 1)`,
    )
  }
}

/** A release is tagged from the pushed branch tip only, so the release notes' commit exists on origin. */
export function assertHeadIsPushed(head: string, remoteHead: string): void {
  if (head !== remoteHead) {
    throw new Error(
      `HEAD ${head} is not origin/dolusoft/main (${remoteHead}); push or pull before releasing`,
    )
  }
}

export function releaseTag(version: string): string {
  return `v${version}`
}

export function tarballName(version: string): string {
  return `grid-layout-plus-${version}.tgz`
}

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

export function inspectPackedManifest(manifest: Record<string, unknown>): string[] {
  const problems: string[] = []

  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field]
    if (!entries || typeof entries !== 'object') continue

    for (const [name, range] of Object.entries(entries as Record<string, unknown>)) {
      if (
        typeof range === 'string' &&
        (range.startsWith('catalog:') || range.startsWith('workspace:'))
      ) {
        problems.push(`${field}.${name} uses "${range}"`)
      }
    }
  }

  return problems
}
