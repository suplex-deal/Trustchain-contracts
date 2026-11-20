# TypeScript SDK Dependency Policy

The TypeScript SDK keeps `@stellar/stellar-sdk` on the current compatible major
version until the SDK invocation client is migrated and verified against a newer
major. `sdk/typescript/package.json` currently pins `@stellar/stellar-sdk` to
`^17.2.1`; that range (and the devDependency ranges for `jest`, `typescript`,
`ts-jest`, `@types/jest`, and `@types/node`) is intentional rather than an
unreviewed stale pin, and must be bumped deliberately, in the same change as the
lockfile, rather than left to float.

The committed `sdk/typescript/package-lock.json` is the actual reproducibility
source for SDK installs, the same role `Cargo.lock` plays for the Rust contracts
(see `cargo build --locked` in `.github/workflows/ci.yml`,
`release.yml`, and `deploy-testnet.yml`). Any install — local or CI — MUST run
against that committed lockfile with `npm ci`, never `npm install`, so the
resolved dependency tree always matches what's checked in:

- `.github/workflows/ci.yml` (`typescript_sdk` job) already does this correctly:
  `npm ci` in `sdk/typescript`, followed by `npm test`, `tsc --noEmit`, and the
  build step.
- `sdk/typescript/README.md`'s "Installation" section previously told SDK
  *consumers* to run `npm install @trustchain/sdk` from the registry, which is
  correct for consumers (there's no lockfile to match when installing a
  published package) but was easy to misread as guidance for *contributors*
  working in this repo. Contributors building the SDK locally must run
  `npm ci` from `sdk/typescript/` to get the exact locked dependency tree
  before `npm run build` / `npm test`, matching the CI job above.

Dependabot monitors `/sdk/typescript` weekly and can update both the manifest
range and the lockfile together; a manual bump of the manifest range without a
regenerated lockfile is not a valid update.