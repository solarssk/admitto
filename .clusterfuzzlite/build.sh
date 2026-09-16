#!/bin/bash -eu

cd "$SRC/admitto"

# Both fuzz targets exercise a pure, dependency-free source file (verified by hand: neither
# csvUtils.ts nor parseUserAgent.ts has a single import statement). typescript and @jazzer.js/core
# are both installed into the isolated .clusterfuzzlite/ prefix rather than this workspace root -
# a plain `npm install <pkg>` run directly at the root was tried first and failed: even with
# --ignore-scripts, npm still ran every OTHER workspace's own `prepare` script (packages/crypto,
# db, location, shared, storage all define one), and packages/storage's `tsc` errors on unbuilt
# @admitto/db/@admitto/auth types since this build has no reason to build the whole monorepo just
# to install one devtool. The isolated --prefix install has no such workspace to cascade into.
# @jazzer.js/core pinned to 2.1.0, not latest (4.0.0): confirmed locally that 4.0.0's prebuilt
# native fuzzer addon requires GLIBC_2.32+, which this base image's Ubuntu userland (GLIBC 2.31)
# doesn't have ("ERR_DLOPEN_FAILED ... GLIBC_2.32 not found"). 2.1.0 is the last release before
# that jump (there is no 3.x on npm) and its own prebuilt loads correctly here.
npm install --no-save --prefix .clusterfuzzlite typescript@5.9 @jazzer.js/core@2.1.0
TSC=.clusterfuzzlite/node_modules/.bin/tsc

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
