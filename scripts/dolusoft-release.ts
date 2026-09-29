// Local release for the Dolusoft fork: test, build, pack, then publish the tarball as an
// immutable GitHub Release asset. Usage: pnpm release:dolusoft [--dry-run]
import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { execa } from 'execa'

import {
  REQUIRED_PACKED_FILES,
  assertDolusoftVersion,
  inspectPackedManifest,
  releaseTag,
  tarballName,
} from './dolusoft-release-checks'
import { logger, rootDir } from './utils'

const dryRun = process.argv.includes('--dry-run')
const outDir = resolve(rootDir, '.release')
const env = { ...process.env, HUSKY: '0' }

async function run(bin: string, args: string[]) {
  return execa(bin, args, { cwd: rootDir, env, stdio: 'inherit' })
}

async function output(bin: string, args: string[], cwd = rootDir) {
  return (await execa(bin, args, { cwd, env })).stdout.trim()
}

async function main() {
  const pkg = JSON.parse(await readFile(resolve(rootDir, 'package.json'), 'utf-8')) as {
    version: string
  }
  const version = pkg.version
  assertDolusoftVersion(version)
  const tag = releaseTag(version)
  const file = tarballName(version)

  if ((await output('git', ['rev-parse', '--abbrev-ref', 'HEAD'])) !== 'dolusoft/main') {
    throw new Error('Release only from dolusoft/main')
  }
  if (await output('git', ['status', '--porcelain'])) throw new Error('Working tree is not clean')
  if (await output('git', ['ls-remote', '--tags', 'origin', tag])) {
    throw new Error(`${tag} already exists on origin; bump the version, never reuse a tag`)
  }

  await run('pnpm', ['run', 'test'])
  await run('pnpm', ['run', 'build'])
  await run('pnpm', ['run', 'test:types'])

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await run('pnpm', ['pack', '--pack-destination', outDir])
  if (await output('git', ['status', '--porcelain', '--', '.', ':!.release'])) {
    throw new Error('pnpm pack changed tracked files (lifecycle scripts?)')
  }

  // tar is called with a relative path from inside outDir: GNU tar reads "C:\..." as a remote host.
  const tarball = resolve(outDir, file)
  const listing = (await output('tar', ['-tzf', file], outDir)).split(/\r?\n/u)
  const missing = REQUIRED_PACKED_FILES.filter(entry => !listing.includes(entry))
  if (missing.length) throw new Error(`Tarball is missing: ${missing.join(', ')}`)
  const packedManifest = JSON.parse(
    await output('tar', ['-xOzf', file, 'package/package.json'], outDir),
  )
  const problems = inspectPackedManifest(packedManifest)
  if (problems.length) throw new Error(`Packed manifest: ${problems.join('; ')}`)

  const sha = await output('git', ['rev-parse', 'HEAD'])
  logger.info(`Ready: ${tag} at ${sha} -> ${tarball}`)
  if (dryRun) return

  await run('git', ['tag', '-a', tag, '-m', `Dolusoft fork release ${version}`])
  await run('git', ['push', 'origin', tag])
  await run('gh', [
    'release',
    'create',
    tag,
    tarball,
    '--repo',
    'dolusoft/grid-layout-plus',
    '--verify-tag',
    '--prerelease',
    '--title',
    `grid-layout-plus ${version} (Dolusoft fork)`,
    '--notes',
    `Built from ${sha} on dolusoft/main. Consume via the asset URL; never overwrite.`,
  ])
  logger.info(`https://github.com/dolusoft/grid-layout-plus/releases/download/${tag}/${file}`)
}

main().catch(error => {
  logger.error(String(error))
  process.exit(1)
})
