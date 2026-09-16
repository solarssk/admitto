FROM gcr.io/oss-fuzz-base/base-builder-javascript

# The two fuzz targets below (split-csv-line, parse-user-agent) each exercise exactly one
# dependency-free source file - copying the whole repo keeps build.sh's paths matching the
# real tree (packages/shared/src/..., apps/admin/src/...) instead of a hand-curated subset that
# would silently go stale as those files move.
COPY . $SRC/admitto
COPY .clusterfuzzlite/build.sh $SRC/
