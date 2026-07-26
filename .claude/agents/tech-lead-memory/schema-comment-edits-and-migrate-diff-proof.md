---
name: schema-comment-edits-and-migrate-diff-proof
description: How to prove a schema.prisma edit implies no migration (Prisma 7.8 flags), and why GalleryItem's scriptureBook index is deliberately retained
metadata:
  type: convention
---

A `//` comment edit in `prisma/schema.prisma` is not a DB change, but it is not
free either: `prisma generate` re-embeds the whole schema text into the generated
client's `inlineSchema` string (`src/generated/prisma/internal/class.ts`), so a
comment-only edit still churns generated output. Always run the full
`npm run build` + both suites after touching the schema, even for a comment.

**Prove "no migration" without a database** — schema-to-schema diff, no shadow DB,
no connection:

```
git show HEAD:prisma/schema.prisma > /tmp/old/schema.prisma
npx prisma migrate diff --from-schema /tmp/old/schema.prisma \
                        --to-schema prisma/schema.prisma --exit-code
# "No difference detected." + exit 0
```

Prisma 7.8 **removed** `--from-schema-datamodel` / `--to-schema-datamodel`; the
flags are now `--from-schema` / `--to-schema`. With `--exit-code`: 0 = empty diff,
2 = non-empty, 1 = error — so a bare exit 0 from a *failed* invocation is not
proof; read the stdout line too. This is the cheap gate that keeps a
documentation pass from accidentally becoming a migration, given
[[prisma-migrate-dev-blocked-by-dbos-table]]-style friction in this project.

**Worked example — `GalleryItem.@@index([scriptureBook])` is RETAINED on purpose**
(decided 2026-07-26, db-lib `8b9e9e4`). The gallery book filter was cut, so no
query uses that index today. It is kept anyway, with the reason inline in the
schema.

**Why:** dropping it buys zero read benefit and costs a schema migration that has
to be authored and deployed to every environment; keeping it leaves the door open
for a future book facet. The only price is a little write amplification on a
low-write table.

**Trade-offs:** the schema now carries an index no query explains, which is
exactly why the justification must live next to it — an unexplained unused index
reads as an oversight and invites a future drop.
