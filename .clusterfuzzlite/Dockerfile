# SonarCloud docker:S6471 (root user) flags this FROM line - accepted, not suppressible: Docker
# doesn't allow trailing comments on an instruction, so its own Docker analyzer has no NOSONAR
# mechanism at all (confirmed against SonarSource's community forum), only a dashboard-level
# Won't Fix/False Positive action. This is a CI-only build image that compiles fuzz binaries and
# never runs as a service, unlike the production Dockerfile's runtime `USER node` (ADR 0043) -
# OSS-Fuzz's own base images are designed to build as root.
FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:2e218dedc1603f15e34cec784030789e06db1df8eb5356f0a8e27285619ac8c2

# Only the exact files build.sh compiles, plus its own directory - not `COPY . $SRC/admitto`
# (SonarCloud docker:S6470, CRITICAL: a recursive copy of the whole repo into a build image can
# pull in anything, secrets included, even with .dockerignore as the only guard). If either
# source path below moves, build.sh's own hardcoded tsc invocations break identically either
# way, so there's no staleness tradeoff in naming them explicitly here too.
COPY packages/shared/src/csvUtils.ts $SRC/admitto/packages/shared/src/csvUtils.ts
COPY apps/admin/src/utils/parseUserAgent.ts $SRC/admitto/apps/admin/src/utils/parseUserAgent.ts
COPY .clusterfuzzlite $SRC/admitto/.clusterfuzzlite
COPY .clusterfuzzlite/build.sh $SRC/
