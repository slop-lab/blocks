# Package Publication and Production-Use Contract

This document defines the boundaries of the public packages and the approval conditions for release. Renaming packages or passing local tests does not mean that they have been published to npm or are production-ready. The incomplete items below must be resolved before an actual release.

## Public and Local Boundary

Only `@slop-lab/blocks` and `@slop-lab/blocks-*` are public library names. Local applications and development tools use `@this-project/*` and must remain `private: true`. Public packages must not have runtime dependencies on local packages.

| Directory | Package name | Publication target |
| --- | --- | --- |
| `packages/model` | `@slop-lab/blocks` | Public core |
| `packages/bindings` | `@slop-lab/blocks-bindings` | Public |
| `packages/containers` | `@slop-lab/blocks-containers` | Public |
| `packages/interactions` | `@slop-lab/blocks-interactions` | Public |
| `packages/prosemirror` | `@slop-lab/blocks-prosemirror` | Public, optional editing engine |
| `packages/markdown` | `@slop-lab/blocks-markdown` | Public |
| `packages/workspace` | `@slop-lab/blocks-workspace` | Public |
| `packages/server-bindings` | `@slop-lab/blocks-server-bindings` | Public, Node host |
| `packages/git-documents` | `@slop-lab/blocks-git-documents` | Public, Node / Git |
| `packages/git-documents-host` | `@slop-lab/blocks-git-documents-host` | Public, Node HTTP host |
| `packages/agent-tools` | `@slop-lab/blocks-agent-tools` | Public, execution-engine independent |
| `packages/agent-tools-part` | `@slop-lab/blocks-agent-tools-part` | Public, optional Part integration |
| Repository root | `@this-project/demo` | Local only |
| `packages/block-docs` | `@this-project/block-docs` | Local only |

Do not change the `block-docs` executable name or existing commands. The current CLI uses the web build from its runtime `dist` location or a repository-relative location. A standalone npm installation does not include the web assets, so the CLI is excluded from publication.
Publishing it later first requires resolving how web assets are included and located, how their version is coupled to the CLI, and proving the real HTTP interface outside the repository. The HTTP host library is a separate public module for consumers that provide an asset path.

Package names and storage formats are independent. Renaming does not migrate the `block-editor/v0.3` and `block-editor.agent` protocol identifiers or persisted data. No aliases are provided for former package names.

## 1. Blockers Before the First npm Publication

- [ ] **License decision**: the rights holder selects a license and aligns each public manifest's `license` field with the LICENSE file in every tarball. All 12 public tarballs currently lack a LICENSE file. Do not declare MIT or another license without authorization. Also verify licenses for external code and assets.
- [ ] **Ownership and permission verification**: verify permissions for the `@slop-lab` scope, availability of all 12 names, and any already-published versions in the actual registry. A local rename does not verify these facts.
- [ ] **Publication metadata**: define a `description`, a genuinely public `repository` and `directory`, and support and issue URLs for every public package. The current public manifests have no `license`, `description`, `repository`, or `publishConfig`. Explicitly configure scoped public access and review the registry and tag.
- [ ] **Per-package documentation**: add installation, a minimal working example, exports, peer dependencies, browser/Node boundaries, and stability and support scope to each README. Among the current public tarballs, only containers has a README. The repository root README is not automatically included in other packages.
- [ ] **Supported environments**: finalize and document the ESM-only public form, TypeScript module resolution, and supported React, ProseMirror, Yjs, and Zod combinations. Verify and document actual minimum Node and Git requirements for Node-only modules. The demo and Part integration require Node `>=24.22.0`; do not present that as a requirement for the entire browser core.
- [ ] **Version and API policy**: verify whether the current public package version `0.1.0` is available for first publication, then define coordinated or independent versioning, changelog, breaking-change, and deprecation policies. Do not assume `0.x` compatibility.
- [ ] **Release automation**: the repository currently has no release CI. Connect a clean checkout, frozen lockfile, package build, validation, tarball inspection, approved publication, and tagging. Keep publication credentials out of source and tarballs, and use least privilege with a protected deployment environment.

These items were intentionally not guessed during the rename. In particular, the license, registry ownership, and public repository URL require decisions from the project owner.

## 2. Consumer-Based Packaging Approval

Running through workspace symlinks differs from running as an npm consumer. Verify the following for every release.

- [ ] Build with supported Node and the pinned pnpm version after `corepack pnpm install --frozen-lockfile`.
- [ ] Pack only the 12 public packages and inspect each tarball's manifest and file list. Every exported JS and `.d.ts` target must exist, with no remaining `workspace:`, former scope, `@this-project/*`, or absolute repository paths.
- [ ] Verify that tarballs contain no `.runtime` data, secrets, development reports, or application code unnecessary to consumers.
- [ ] Install into an empty consumer outside the repository and verify public root and subpath exports, `.d.ts` files, peer combinations, and real API calls. Also verify that a viewer-only consumer does not pull in ProseMirror, Node, or Part.
- [ ] Run supported OS and browser combinations in CI. Passing Linux checks alone does not establish Windows or macOS support.
- [ ] Publish in dependency-graph order so public dependencies exist first. Install the complete graph from a staging registry, then install and run it again without local overrides after publication to the actual registry.

During pack and publish, pnpm converts `workspace:*` to the corresponding version. Because internal dependencies are currently `0.1.0`, installing only an upper-level package tarball causes registry 404 errors for unpublished lower-level packages. Local overrides used during tarball consumer verification only substitute for name resolution; they do not prove actual registry publication.

The current rename has verified root imports for the 12 public tarballs, execution of the core codec, and an external consumer TypeScript check. It does not replace verification of every subpath, supported OS, or installation from the actual registry.

The baseline in-repository regression checks are:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:browser
corepack pnpm test:git-documents-browser
```

Browser checks require the installed Playwright Chromium or `CHROME_PATH`. Do not run publication commands for the two local packages. This checklist is not an instruction to publish.

## 3. Before Integration into a Real Product

### Authentication and Host Responsibilities

- [ ] Replace the demo identity selector and signed cookie with real login, tenant and resource authorization, and session-rotation policies. Do not treat a read-only presentation in the UI as an authorization check.
- [ ] Configure HTTPS, trusted proxies, Secure cookies, origin policy, request-size and rate limits, and execution budgets for the deployment environment. Do not expose the demo server directly to the public internet.
- [ ] Define the user schema and renderer, opaque-data preservation and external-link policies, and host mutation contracts. Do not let the editor core become the owner of business authorization or workflows.

### Persistence and Recovery

- [ ] Verify backup and restoration, schema changes, CAS conflict UI, and retry after failure for existing JSON and Markdown using real production data. Preserve single ownership of existing content and history.
- [ ] Do not treat the file store's single-process queue as a multi-worker or distributed-transaction guarantee. Replace the storage adapter and concurrency control before scaling to multiple processes.
- [ ] Verify collaborative disconnect and reconnect, server shutdown and restart, disk errors and exhausted storage, and backup recovery. Define retention, audit, observability, and sensitive-data deletion policies.
- [ ] Provide a real Git execution environment and user credentials for Git hosts, and verify worktree, branch, conflict recovery, and remote errors. Do not recover through automatic reset or force-push.

### Part Tools and Models

- [ ] The default `Deterministic fixture / No model connected` is an example using the real Part dispatcher, not evidence of an external LLM connection. Validate separately with the provider, model, endpoint, and credentials that will be used.
- [ ] Keep model credentials and tool authorization on the server, and treat documents and tool results as untrusted input. Separate model proposal generation from user-approved application to canonical data.
- [ ] Verify exact agreement between the read set, hashes, revisions, and approval target, as well as late results after cancellation, duplicate requests, session isolation, budget exhaustion, and record redaction in the real host.
- [ ] The journal retains at most 100 command receipts and events. Provide a separate durable store and retention policy if long-term audit or permanent duplicate prevention is required.
- [ ] Do not automatically reapply `application-failed` or `application-incomplete` operations. Establish recovery and operational procedures to determine whether canonical data may have changed before the failure. Do not assume cross-resource atomicity between linked Markdown reads and backlog mutations.

## References

- [pnpm workspace dependency conversion during pack/publish](https://pnpm.io/workspaces#publishing-workspace-packages)
- Ownership and persistence contracts: `source-runtime.md`, `interaction.md`
- Tool and execution contract: `agent-tools.md`
- Validation layers: `testing.md`
