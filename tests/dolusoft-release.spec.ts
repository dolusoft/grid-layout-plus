import { describe, expect, it } from 'vitest'

import {
  REQUIRED_PACKED_FILES,
  assertDolusoftVersion,
  inspectPackedManifest,
  releaseTag,
  tarballName,
} from '../scripts/dolusoft-release-checks'

describe('dolusoft release checks', () => {
  it('accepts the fork version scheme', () => {
    expect(() => assertDolusoftVersion('2.0.0-beta.0.dolusoft.1')).not.toThrow()
    expect(() => assertDolusoftVersion('2.0.0.dolusoft.12')).toThrow()
    expect(() => assertDolusoftVersion('2.0.0-beta.0')).toThrow()
    expect(() => assertDolusoftVersion('2.0.0-beta.0.dolusoft.0')).toThrow()
    expect(() => assertDolusoftVersion('2.0.0-beta.0.dolusoft.1-rc')).toThrow()
  })

  it('derives tag and tarball names', () => {
    expect(releaseTag('2.0.0-beta.0.dolusoft.3')).toBe('v2.0.0-beta.0.dolusoft.3')
    expect(tarballName('2.0.0-beta.0.dolusoft.3')).toBe(
      'grid-layout-plus-2.0.0-beta.0.dolusoft.3.tgz',
    )
  })

  it('flags unresolved workspace protocols in the packed manifest', () => {
    const problems = inspectPackedManifest({
      name: 'grid-layout-plus',
      dependencies: { '@vexip-ui/utils': 'catalog:', interactjs: '^1.10.27' },
      peerDependencies: { vue: 'workspace:*' },
    })
    expect(problems).toEqual([
      'dependencies.@vexip-ui/utils uses "catalog:"',
      'peerDependencies.vue uses "workspace:*"',
    ])
  })

  it('accepts a clean manifest', () => {
    expect(
      inspectPackedManifest({
        name: 'grid-layout-plus',
        dependencies: { '@vexip-ui/utils': '^2.16.4' },
        peerDependencies: { vue: '^3.5.0' },
      }),
    ).toEqual([])
  })

  it('lists the files a consumer needs', () => {
    expect(REQUIRED_PACKED_FILES).toEqual([
      'package/package.json',
      'package/LICENSE.md',
      'package/es/index.mjs',
      'package/lib/index.cjs',
      'package/dist/index.d.ts',
      'package/dist/style.css',
    ])
  })
})
