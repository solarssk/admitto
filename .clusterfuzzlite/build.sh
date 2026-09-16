#!/bin/bash -eu

cd "$SRC/admitto"

# Both fuzz targets exercise a pure, dependency-free source file (verified by hand: neither
# csvUtils.ts nor parseUserAgent.ts has a single import statement). typescript and @jazzer.js/core
# are installed from this directory's own package.json/package-lock.json into the isolated
# .clusterfuzzlite/ prefix, rather than at this workspace root - a plain `npm install <pkg>` run
# directly at the root was tried first and failed: even with --ignore-scripts, npm still ran every
# OTHER workspace's own `prepare` script (packages/crypto, db, location, shared, storage all
# define one), and packages/storage's `tsc` errors on unbuilt @admitto/db/@admitto/auth types
# since this build has no reason to build the whole monorepo just to install two devtools. The
# isolated --prefix install has no such workspace to cascade into.
#
# `npm ci`, not `npm install`: this directory's package-lock.json pins the full resolved tree
# (including transitive dependencies), so every build resolves identically instead of drifting
# with whatever the registry currently serves for a loose semver range - `npm ci` also refuses to
# proceed if package.json and the lockfile disagree, rather than silently re-resolving.
#
# `--ignore-scripts`, then `npm rebuild` for exactly one package: confirmed by hand that exactly
# one package in this whole tree defines an install script - @jazzer.js/fuzzer's own
# `"install": "prebuild-install --runtime napi || npm run prebuild"`, which places its native
# addon (nothing else, typescript included, runs any script). `npm ci --ignore-scripts` blocks
# every script tree-wide, including that one; `npm rebuild @jazzer.js/fuzzer` then explicitly
# re-runs scripts for only that package - verified the addon is genuinely absent after the first
# command and present (and loadable) after the second, so this isn't a redundant step.
npm ci --ignore-scripts --prefix .clusterfuzzlite
npm rebuild --prefix .clusterfuzzlite @jazzer.js/fuzzer
TSC=.clusterfuzzlite/node_modules/.bin/tsc

# @jazzer.js/core pinned to 2.1.0, not latest (4.0.0), in package.json: confirmed locally that
# 4.0.0's prebuilt native fuzzer addon requires GLIBC_2.32+, which this base image's Ubuntu
# userland (GLIBC 2.31) doesn't have ("ERR_DLOPEN_FAILED ... GLIBC_2.32 not found"). 2.1.0 is the
# last release before that jump (there is no 3.x on npm) and its own prebuilt loads correctly
# here. package.json also overrides the `tar` transitive dependency (pulled in via
# cmake-js -> @jazzer.js/fuzzer) to >=7.5.21: 2.1.0's own dependency tree resolves an unpatched
# `tar` with several real CVEs (arbitrary file write via hardlink/symlink path traversal,
# GHSA-34x7-hfp2-rc4v and others) - `npm audit` against this lockfile reports zero vulnerabilities
# with the override in place, confirmed the override doesn't break prebuild-install's own
# extraction (the native addon still loads correctly after `npm rebuild` above).

# --target/--lib ES2022 matches tsconfig.base.json's own setting for the whole monorepo - a
# lower target broke this the first time (parseUserAgent.ts's String.prototype.replaceAll needs
# ES2021+, so `--target es2020` failed with TS2550 during local verification).
mkdir -p .clusterfuzzlite/.build
"$TSC" packages/shared/src/csvUtils.ts \
  --outDir .clusterfuzzlite/.build/shared --module commonjs --target es2022 --lib es2022 --skipLibCheck
"$TSC" apps/admin/src/utils/parseUserAgent.ts \
  --outDir .clusterfuzzlite/.build/admin --module commonjs --target es2022 --lib es2022 --skipLibCheck

# Renamed .js -> .cjs: this workspace's root package.json (copied in alongside these compiled
# files) declares "type": "module", so Node treats any plain .js file under it as ESM by
# extension alone - tsc's --module commonjs output would otherwise fail at runtime with
# "exports is not defined" (or the fuzz targets' own require() calls into them would fail with
# "require is not defined in ES module scope"), confirmed locally on both counts.
mv .clusterfuzzlite/.build/shared/csvUtils.js .clusterfuzzlite/.build/shared/csvUtils.cjs
mv .clusterfuzzlite/.build/admin/parseUserAgent.js .clusterfuzzlite/.build/admin/parseUserAgent.cjs

# compile_javascript_fuzzer's own comment says it "installs Jazzer.js into the project", but the
# script itself only copies $SRC/admitto into $OUT/admitto - the generated wrapper then execs
# <copied-project>/node_modules/@jazzer.js/core/dist/cli.js, so that package (and its own
# dependency tree) has to already be sitting in this project's real node_modules *before* the
# copy happens, or every wrapper fails at run time with "No such file or directory" (confirmed
# locally). Copying the isolated prefix install's node_modules here - rather than installing
# straight into this directory - is what avoids the workspace-wide prepare cascade above.
mkdir -p node_modules
cp -r .clusterfuzzlite/node_modules/. node_modules/

compile_javascript_fuzzer admitto .clusterfuzzlite/fuzz/split-csv-line.fuzz.cjs --sync
compile_javascript_fuzzer admitto .clusterfuzzlite/fuzz/parse-user-agent.fuzz.cjs --sync
