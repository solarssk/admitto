# SonarCloud docker:S6471 (root user) flags this FROM line - accepted, not suppressible: Docker
# doesn't allow trailing comments on an instruction, so its own Docker analyzer has no NOSONAR
# mechanism at all (confirmed against SonarSource's community forum), only a dashboard-level
# Won't Fix/False Positive action. This is a CI-only build image that compiles fuzz binaries and
# never runs as a service, unlike the production Dockerfile's runtime `USER node` (ADR 0043) -
# OSS-Fuzz's own base images are designed to build as root.
FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:2e218dedc1603f15e34cec784030789e06db1df8eb5356f0a8e27285619ac8c2

# Only the exact files build.sh needs, named individually - not `COPY . $SRC/admitto` (SonarCloud
# docker:S6470, CRITICAL: a recursive copy of the whole repo into a build image can pull in
# anything, secrets included, even with .dockerignore as the only guard) and not even
# `COPY .clusterfuzzlite $SRC/admitto/.clusterfuzzlite` (still a directory copy - would also pull
# in .clusterfuzzlite/.build or .clusterfuzzlite/node_modules if either happens to exist on the
# machine running `docker build`, e.g. left over from local testing, even though neither is ever
# committed). If any source path below moves, build.sh's own hardcoded references to it break
# identically either way, so there's no staleness tradeoff in naming every one of them here too.
COPY packages/shared/src/csvUtils.ts $SRC/admitto/packages/shared/src/csvUtils.ts
COPY packages/shared/src/parseUserAgent.ts $SRC/admitto/packages/shared/src/parseUserAgent.ts
COPY .clusterfuzzlite/package.json $SRC/admitto/.clusterfuzzlite/package.json
COPY .clusterfuzzlite/package-lock.json $SRC/admitto/.clusterfuzzlite/package-lock.json
COPY .clusterfuzzlite/fuzz/split-csv-line.fuzz.cjs $SRC/admitto/.clusterfuzzlite/fuzz/split-csv-line.fuzz.cjs
COPY .clusterfuzzlite/fuzz/parse-user-agent.fuzz.cjs $SRC/admitto/.clusterfuzzlite/fuzz/parse-user-agent.fuzz.cjs
COPY .clusterfuzzlite/build.sh $SRC/admitto/.clusterfuzzlite/build.sh
COPY .clusterfuzzlite/build.sh $SRC/build.sh
