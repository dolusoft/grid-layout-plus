# 发布流程

本项目使用 Changesets 管理版本、`CHANGELOG.md`、npm 发布、Git tag 和 GitHub Release。

## 提交面向用户的改动

执行：

```bash
pnpm changeset
```

选择 `grid-layout-plus`、对应的 SemVer 级别，并使用简洁的英文描述面向用户的变化。将生成的
`.changeset/*.md` 文件与功能代码一起提交。仅修改文档、测试或内部维护代码时不需要 changeset。

## 发布正式版本

1. 带 changeset 的改动合并到 `main` 后，CI 与独立的 Release workflow 分别启动。
2. Release workflow 安装依赖并构建包，然后运行 Changesets Action。
3. Changesets Action 创建或更新 `release: version packages` PR。
4. 版本 PR 会更新 `package.json` 和 `CHANGELOG.md`，并消费已合并的 changeset 文件。
5. 合并版本 PR 后，CI 再次验证；通过后自动构建并发布 npm 包。
6. 发布成功后自动创建 `v<version>` tag 和 GitHub Release。
7. Release workflow 根据已发布版本推进文档部署分支：稳定版进入 `docs-release`，预发布版进入
   `docs-next`。

仓库需要在 npm 配置 Trusted Publisher，指向 `qmhc/grid-layout-plus` 的 `release.yml`，并授予
`npm publish` 权限；Release workflow 通过 GitHub OIDC 发布 npm 包，因此需要
`id-token: write` 权限。仓库还需要允许 GitHub Actions 创建 Pull Request。不要手动修改版本号、
`CHANGELOG.md` 或创建发布 tag。

## 文档部署

生产文档只跟随 npm 稳定版。Netlify 的 Production branch 必须配置为 `docs-release`；普通
`main` 提交和版本 PR 创建不会更新生产文档。带 `-beta`、`-rc` 等后缀的预发布版本会推进
`docs-next`，可通过 Netlify branch deploy 提供预览。

文档分支只由 Release workflow 在 Changesets 确认发布成功后推进，且始终指向本次发布对应的
提交。不要手动向这两个分支提交、rebase 或 force push。首次启用时，`docs-release` 从当前 npm
稳定版对应的 tag 创建；后续发布只进行 fast-forward 更新。

## 本地检查

```bash
pnpm exec changeset status
```

`pnpm run version-packages` 会实际修改版本与 changelog，应只在排查版本 PR 时使用。
`pnpm run release` 会尝试发布到 npm，应只由 CI 调用。

## Dolusoft fork releases

The `dolusoft/grid-layout-plus` fork does not publish to npm and does not use Changesets.
Its releases are tarballs attached to GitHub Releases, built locally from the `dolusoft/main`
branch. The upstream Release workflow is guarded by `github.repository` and never runs here.

### Version scheme

`<upstream version>-[<prerelease>.]dolusoft.<n>`, for example `2.0.0-beta.0.dolusoft.1`.

- `<upstream version>` is the upstream version the fork is based on.
- `<n>` starts at 1 and increases with every fork release; it never resets while the upstream base
  stays the same.
- A prerelease suffix is required (`1.1.2-dolusoft.1` is valid, `2.0.0.dolusoft.1` is not). A fork
  build therefore sorts below the next upstream stable release. On a prerelease base it sorts
  above its own base and below the next upstream prerelease: `2.0.0-beta.0` <
  `2.0.0-beta.0.dolusoft.1` < `2.0.0-beta.1` < `2.0.0`.

The tag is `v<version>` and the asset is `grid-layout-plus-<version>.tgz`.

### Steps

1. Bump `version` in `package.json` on `dolusoft/main` and commit.
2. Run `pnpm release:dolusoft --dry-run`. It refuses to run on another branch, with a dirty working
   tree or when the tag already exists on `origin`; then it runs the tests, the build and the type
   tests, packs the tarball into `.release/`, checks that the consumer files are in it and that
   the packed manifest has no `catalog:` or `workspace:` ranges. It only warns if `HEAD` is not
   pushed yet.
3. Push `dolusoft/main`.
4. Run `pnpm release:dolusoft`. It repeats the checks, refuses to continue unless `HEAD` equals
   `origin/dolusoft/main`, then creates an annotated tag, pushes it and creates a prerelease with
   the tarball as its asset.

If the dry run fails, fix it in a new commit and start again from step 2.

### If the release step fails after the tag is pushed

When `gh release create` fails (network, auth) after `git push origin <tag>` succeeded, `origin`
has a tag without a Release, and rerunning `pnpm release:dolusoft` is refused because the tag
exists. Do not delete or move the tag. Either create the Release for that tag by hand from the
tarball the run left in `.release/`, which was built from the tagged commit:

```bash
gh release create v<version> .release/grid-layout-plus-<version>.tgz \
  --repo dolusoft/grid-layout-plus --verify-tag --prerelease \
  --title "grid-layout-plus <version> (Dolusoft fork)" \
  --notes "Built from <sha> on dolusoft/main. Consume via the asset URL; never overwrite."
```

or, if `.release/` no longer matches the tagged commit, leave the tag as it is and release the
next `<n>`.

### Immutability

A published tag is never moved and a published asset is never replaced or deleted. A broken
release is fixed by releasing the next `<n>`.

### Consuming a release

Reference the asset URL of a specific version; there is no `latest` URL:

```json
"grid-layout-plus": "https://github.com/dolusoft/grid-layout-plus/releases/download/v<version>/grid-layout-plus-<version>.tgz"
```

Update the manifest and the lockfile in the same commit.

### Fork deviations

These fork changes are deliberate. Keep them when merging upstream; do not resolve a conflict by
taking the upstream side. A consumer (Dolusoft `frontendx`) relies on each of them to draw saved
dashboards exactly where `grid-layout-plus` 1.1.1 drew them.

Behaviour and API:

- **`gridToPixelRect` column start order** (`src/core/utils.ts`). `inlineStart` is computed as
  `item.x * cellWidth + (padding + item.x * gap)`, the same operation order as 1.1.1
  (`cellWidth * x + margin * (x + 1)`). Upstream's `padding + x * (cellWidth + gap)` is equal on
  paper but lands on the other side of `.5` for some positions and draws those items 1px off (753
  of about 218k checked positions). Guarded by `tests/v1-pixel-rounding.spec.ts`.
- **`roundedStrategy` / `v1PixelStrategy`** (`src/core/position-strategies.ts`, exported from the
  root and `core` entries). `roundedStrategy(base)` rounds the pixel values a strategy writes;
  `v1PixelStrategy = roundedStrategy(transformStrategy)`. The pixel equality with 1.1.1 comes
  from the column start order above, not from the rounding alone.
- **`PositionStrategy.roundsGeometry`** (`src/helpers/types.ts`, `src/core/validation.ts`,
  `src/core/position-style.ts`, `src/components/grid-layout/position-style-controller.ts`).
  `roundedStrategy` sets it. When `true`, the style controller rounds the item geometry with
  `Math.round` before calling the strategy and validates the returned styles against that rounded
  geometry, still character for character. Without it the validator compared the rounded styles
  with the unrounded geometry and rejected every batch on a fractional column width
  (`extension-invalid-result`, items left unpositioned). Strategies without the flag are validated
  exactly as upstream does. Guarded by `tests/v1-pixel-rounding.spec.ts`
  ("v1PixelStrategy inside GridLayout").
- **`Compactor.resolvesCollisions`** (`src/helpers/types.ts`, `src/core/normalize.ts`,
  `src/core/validation.ts`, `src/core/layout-engine.ts`). When `true`, `push` normalization skips
  its own displacement pre-pass and hands the overlapping layout to `compact()`; the result is
  still validated and must be overlap-free. The flag is part of config equality and of the
  "compactor changed" check. Guarded by `tests/v1-pipeline.spec.ts`.
- **v1 compactors** (`src/core/v1-compactor.ts`): `compactV1`, `createV1Compactor`,
  `v1VerticalCompactor`, `v1NoVerticalCompactor`. They reproduce 1.1.1 compaction (checked
  against the 1.1.1 oracle in `tests/oracle/`) and set `resolvesCollisions`. `scripts/build.ts`
  asserts `v1VerticalCompactor` in every entry; `scripts/benchmark-dolusoft.ts` measures them.
  Guarded by `tests/v1-compactor.spec.ts`.
- **Unchanged styles keep their object** (`src/helpers/style-equality.ts`,
  `src/components/grid-item.vue`, `src/components/grid-layout.vue`). Every commit and every drag
  step bumps `positionStyleRevision`, and each GridItem then recomputes its style. Upstream
  assigned a new style object even when the values were the same, so every item re-rendered
  whenever any item moved. GridItem now assigns the new style only when `sameStyle` finds a
  difference; GridLayout does the same for the root `height` (`updateHeight`) and for
  `renderedLayoutStyle`. No rendered value changes, only the number of renders. Guarded by
  `tests/style-equality.spec.tsx`, which counts GridItem `updated` hooks in the cell-component
  pattern frontendx uses (one component per cell placing its own GridItem). Items rendered
  directly in GridLayout's `item` slot, or directly in its default slot inside a `v-for`, still
  re-render whenever GridLayout re-renders: Vue force-updates a child whose slots close over
  `v-for` variables. That is Vue's slot rule, not a style write, and this fork does not change it. are documented in `docs/guide/core-api.md`, `docs/guide/api-index.md`,
`docs/guide/properties.md` and their `docs/zh/` counterparts.

Dependencies and tooling:

- **All dependencies updated to latest** (Vue `^3.5.43` in the catalog, peer `vue: ^3.5.0`), with
  these exceptions:
  - D2-1: `typescript` is pinned to `6.0.3`. TypeScript 7 ships no JS compiler API, which
    `@vue/compiler-sfc`, `vite-plugin-dts` and `typescript-eslint` need.
  - D2-2: `@vue/language-core` is an explicit devDependency because `vite-plugin-dts` 5 requires
    it as a peer.
  - D2-3: `sass` stays at `^1.105.0`; `1.105.1` was still inside pnpm's `minimumReleaseAge`
    window. Update it once the window has passed.
- **pnpm 12.8.1** (`packageManager`) and `engines.node` `^22.22.1 || ^24.0.0 || >=26.0.0` (the
  strictest dev toolchain floor). pnpm 12 no longer reads the `pnpm` field of `package.json`:
  `peerDependencyRules`, `overrides` and `allowBuilds` live in `pnpm-workspace.yaml`. Do not move
  them back.
- **Release flow**: `scripts/dolusoft-release.ts`, `scripts/dolusoft-release-checks.ts`,
  `tests/dolusoft-release.spec.ts`, the `release:dolusoft` script, `/.release/` in `.gitignore`
  and the `dolusoft/main` branch in `.github/workflows/ci.yml`.
