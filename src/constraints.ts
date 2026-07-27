/**
 * Names of database constraints that CROSS a repository boundary — i.e. constraints
 * another service has to recognize by name at runtime.
 *
 * Most of this schema's constraints never need a constant: Prisma generates them from
 * the DSL, so a violation is recognizable from the model and the fields the caller just
 * wrote. The exception is an index Prisma did NOT generate: nothing identifies it but its
 * raw INDEX NAME, so the name itself becomes the contract between the migration that
 * creates it and the service that maps the violation to an HTTP status.
 *
 * How a service reads that name is NOT `meta.target`: that field does not exist on a
 * `P2002` at all on Prisma 7.8.0 + `@prisma/adapter-pg` (this package's only client
 * factory). The name is reachable only through the driver adapter's passthrough, which
 * `uniqueViolationIndexName` below parses — so match with
 * `isUniqueViolationOn(err, PROJECT_ACTIVE_REPO_UNIQUE_INDEX)` and nothing else.
 *
 * Exactly one index meets that bar today (task #49). Keep this file to that rule: a constant
 * here means "some other repo matches on this string"; a constraint only this package's
 * own tests care about does not belong here.
 */

/**
 * The PARTIAL UNIQUE index backing "one repo ↔ one project **per owner**" (task #49):
 *
 * ```sql
 * CREATE UNIQUE INDEX "Project_ownerId_repoOwner_repoName_active_key"
 *   ON "Project"("ownerId", "repoOwner", "repoName")
 *   WHERE "deletedAt" IS NULL;
 * ```
 *
 * It closes a TOCTOU in `POST /v1/projects`, where the invariant was previously enforced
 * only by a `findFirst`-then-`create` check made OUTSIDE the write transaction: two
 * concurrent requests for the same repo both passed the check and produced two `Project`
 * rows and two scaffold workflows for one GitHub repo.
 *
 * Consume it in the API's create AND import paths: catch `P2002`, test it with
 * `isUniqueViolationOn(err, PROJECT_ACTIVE_REPO_UNIQUE_INDEX)`, and answer the loser with
 * the existing 409 `project_exists` rather than letting a raw Prisma error become a 500.
 * Two properties of the surrounding code make that the only workable shape:
 *
 * - `meta.target` does not exist on Prisma 7.8.0 + `@prisma/adapter-pg` — it is
 *   `undefined` for this raw index and for DSL-generated `@@unique`s alike, so a mapper
 *   keyed to it never matches and ships the 500 this index exists to prevent. The
 *   supported reader is `uniqueViolationIndexName` below; read its docstring first.
 * - the catch must wrap the whole `$transaction` call, never sit inside the callback: a
 *   `P2002` raised inside a Prisma interactive transaction aborts it (25P02) because
 *   Prisma issues no SAVEPOINT.
 *
 * The `WHERE "deletedAt" IS NULL` predicate is why this cannot be an `@@unique` in
 * `schema.prisma` (the DSL has no `where`) and why a soft-deleted project does not block
 * re-creating one for the same repo.
 */
export const PROJECT_ACTIVE_REPO_UNIQUE_INDEX =
  "Project_ownerId_repoOwner_repoName_active_key" as const;

/**
 * The name of the unique index a Prisma `P2002` violated, or `null` if `err` is not a
 * unique violation (or names no index).
 *
 * **Read the measurement before changing this.** On Prisma 7.8.0 driven through
 * `@prisma/adapter-pg` — the only way this package ever constructs a client — a `P2002`
 * carries **no `meta.target` at all**, for raw indexes *and* for DSL-generated
 * `@@unique`s alike. The violated name is only reachable through the driver adapter's
 * passthrough of the Postgres message:
 *
 * ```
 * err.meta.driverAdapterError.cause.originalMessage
 *   === 'duplicate key value violates unique constraint "<index name>"'
 * ```
 *
 * Every pre-driver-adapter guide (and Prisma's own older docs) says to switch on
 * `err.meta.target`. A service that does reads `undefined`, fails to recognize the
 * violation, and returns a 500 where it meant to return a 409 — silently, with nothing
 * red. Centralizing the read here is what stops that from being re-derived, and
 * mis-derived, in each consuming repo.
 *
 * Duck-typed on purpose: never `instanceof PrismaClientKnownRequestError`. db-lib is a
 * nested `file:` dependency of both api and dbos, so a consumer can easily hold a
 * different copy of the Prisma error class than the one that threw
 * (`auth-service.ts` / `gallery-service.ts` document the same rule).
 *
 * The legacy `meta.target` shapes are still honoured even though they do not exist on
 * this stack, so the reader keeps working if a future Prisma restores them: a **string**
 * target is an index name; an **array** target is a field list and deliberately yields
 * `null`, because a field list is not an index name and matching one against an index
 * name would only ever succeed by coincidence.
 */
export function uniqueViolationIndexName(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as {
    code?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { originalMessage?: unknown } };
    };
  };
  if (e.code !== "P2002") return null;

  const original = e.meta?.driverAdapterError?.cause?.originalMessage;
  if (typeof original === "string") {
    const named = /unique constraint "([^"]+)"/.exec(original);
    if (named?.[1]) return named[1];
  }

  // Legacy fallback only — a string target is an index name, an array target is a field
  // list and yields `null` (see the docstring). `meta.target` does not exist on Prisma
  // 7.8.0 + `@prisma/adapter-pg`; this branch is forward-compatibility, nothing more.
  const target = e.meta?.target;
  return typeof target === "string" ? target : null;
}

/**
 * True iff `err` is a Prisma unique violation of the index named `indexName`.
 *
 * The intended shape at a call site — note the catch wraps the WHOLE `$transaction`
 * call, never sits inside the callback, because a `P2002` raised inside a Prisma
 * interactive transaction aborts it (25P02; Prisma issues no SAVEPOINT):
 *
 * ```ts
 * try {
 *   return await prisma.$transaction(async (tx) => { ... });
 * } catch (err) {
 *   if (isUniqueViolationOn(err, PROJECT_ACTIVE_REPO_UNIQUE_INDEX)) {
 *     throw new ProjectAlreadyExistsError();  // 409, not 500
 *   }
 *   throw err;                                 // everything else is unchanged
 * }
 * ```
 *
 * Narrow by design: it returns `false` for every other error, including a `P2002` on a
 * *different* index of the same table, so an unrecognized failure is rethrown rather
 * than mistranslated. `Project` carries two uniques that both fire from one `create`
 * (this index and `Project_ownerId_slug_key`); conflating them would answer a duplicate
 * slug with "a project already exists for this repository".
 */
export function isUniqueViolationOn(err: unknown, indexName: string): boolean {
  return uniqueViolationIndexName(err) === indexName;
}
