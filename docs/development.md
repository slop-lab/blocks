# Development checks and workspace setup

Use Node.js 24.22.0 or newer and pnpm 10.17.1, as declared in `package.json`.
`mise install` provides the pinned tools in `mise.toml`; alternatively install
the declared pnpm version using your normal tool manager. Corepack is optional,
not a prerequisite. Install dependencies with `pnpm install --frozen-lockfile`.
The existing prepare script builds the workspace packages.

## Quality gate

QG and its optional JS and Biome rule packages are pinned to 0.1.0. The root
configuration retains the recommended Git, file, Markdown, reference, and
suppression policies. It explicitly activates test-fixture, package-name,
pnpm-lockfile, and Biome formatting rules. Public package names remain
`@slop-lab/blocks` and `@slop-lab/blocks-*`; the demo and docs CLI stay private.

```sh
pnpm check             # all working-tree files, then lint, types, build and tests
pnpm check:staged      # staged paths and index contents, then the same checks
pnpm check:hook        # reproduce the complete pre-commit hook
pnpm hooks:install    # install the project-local hook explicitly
pnpm exec qg rules    # list loaded rule metadata (not effective enablement)
```

QG automatically installs or updates its own local pre-commit hook on its first
operational invocation. It does not overwrite another hook manager's custom
hook. Resolve such a conflict explicitly; do not bypass checks. No package or
script is downloaded by the installed hook during a commit.

Bare `pnpm exec qg check` defaults to staged input, not the entire repository.
Staged rules read the Git index, but command checks always read the working tree.
Partially staged files therefore need careful review. Use `pnpm check` before
handoff or CI. For a quick rule-only full scan use
`pnpm exec qg check --full --rules-only`; this does not replace the complete gate.

The document-library Git subprocess boundary discards inherited repository/index
selectors from an enclosing Git hook, while preserving author identity and
authentication settings. Its regression tests cover foreign repository selectors;
the fixture's direct Git helper also discards the enclosing hook's index selector.
This lets the same real Git/worktree tests run inside pre-commit without changing
the caller's index or weakening the hook.

The Biome adapter validates staged formatting. `pnpm lint` also checks full-tree
lint and import organization because QG 0.1.0's Biome adapter supports reliable
format-mode diagnostics, not full check-mode diagnostics. The test command first
builds the application because HTTP boundary tests exercise its production assets.
Vitest uses jsdom storage with Node's native Web Storage disabled so Node 24 and
26 use the same browser test environment. It runs through a command check, not
QG's Node-test runner. There is no synthetic coverage target.

The optional JS collection is composed deliberately: `js-test-fixtures` plus
the published package-name and package-manager rule collections in
`qg-rules.mjs`. We do not select `js-directives`: requiring a decorative
`@ts-check` comment in every existing JavaScript server and browser harness
would not establish a real `checkJs` typechecking contract. The existing strict
TypeScript project and each package's typecheck remain enforced. No source,
documentation, example, or UI tree is excluded from the gate.

The artifact registry classifies only the local pnpm download store, runtime
data, agent scratch data, and browser reports as generated. These ignored local
outputs are not maintained source; checking third-party cache blobs would make
the full scan depend on which packages or examples a developer previously ran.
QG's built-in generated lockfile classification does not waive lockfile integrity.

## Browser checks

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

Build first (`pnpm check` includes the production build). The scenarios start
isolated local servers. Only the core `app/tests/browser.mjs` scenario honors
`QA_BASE_URL` to select an existing server; the complete suite is not a check
of an external deployment. Set
`CHROME_PATH` to use an existing Chromium executable. Browser checks cover the
actual example interactions, persistence, errors, collaboration, source
ownership, structured editing, IME, focus, and responsive layouts. They are
separate from the commit hook so each commit does not require a browser download.
CI runs them after the full QG gate.
The runner includes the Git document library and starts an ephemeral Vite server
for the isolated table/code harness. For just the library, run
`pnpm test:git-documents-browser`.

`qg rules` lists loaded metadata defaults, so an explicitly activated opt-in
rule can still appear off in that listing. The root configuration and an actual
`pnpm exec qg check --full --rules-only` run establish effective rule behavior.

Keep multilingual user documents and IME/codec regression inputs unchanged.
English is the language of product-owned controls, help, errors, and bundled
example prose, not a restriction on what users can write or import.

## DIM and publication

This is an ordinary checkout of `https://github.com/slop-lab/blocks.git` and
needs no `.dim` directory. The removed legacy Compose setup, Dockerfiles,
setup/teardown scripts, and home backup helper belonged to an obsolete host
workflow; they are not current DIM repository hooks. They also assumed injected
Git credentials, privileged nested Docker, and host controller sockets.

Current DIM owns host composition outside this repository. `.dim/repos.yml`
is read only by the Native Git plugin during an explicit reviewed-policy import
or policy update; normal workspace creation does not discover it. This project
declares no host plugin requirements, managed repository policy, reviewer IDs,
or upstream publication mapping. Inventing those would change operator policy.
See the current [DIM repository configuration guide](https://github.com/slop-lab/dev-infra-manager/blob/main/docs/guides/repository-configuration.md).

Local commits do not publish npm packages, create a GitHub pull request, or
deploy the site. An authorized operator must review and publish the branch with
their normal credentials. Do not mount or copy host/operator credentials into
the coding container, and do not force-push protected refs.
