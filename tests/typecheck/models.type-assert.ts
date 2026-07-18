// Type-level compile check for the Task #4 models. Compiled with
// `tsc --noEmit` by src/schema.test.ts. It proves (at the type level) that the
// five model types are exported and shaped as designed, and — via the
// `@ts-expect-error` on `.token` — that GithubConnection exposes NO token field
// (a compile-time twin of the runtime "no token column" assertion). If any
// `@ts-expect-error` stops describing a real error (e.g. someone adds a token
// field, or widens youversionUserId), tsc reports the unused directive and the
// check fails.

import type {
  GithubConnection,
  GlooConnection,
  OpenRouterConnection,
  Session,
  User,
} from "../../src/index";

// A fully-typed User row — asserts the scalar shape, including the nullable
// onboardingCompletedAt and the Date/string field types.
export const user: User = {
  id: "usr_1",
  youversionUserId: "yv_1",
  displayName: "Ash",
  email: "ash@example.com",
  avatarInitials: "AS",
  firstSignInAt: new Date(),
  onboardingCompletedAt: null,
  lastSeenAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// youversionUserId must be a string, not a number.
export const badUser: User = {
  ...user,
  // @ts-expect-error youversionUserId is a string
  youversionUserId: 123,
};

export function fieldRefs(
  session: Session,
  github: GithubConnection,
  openrouter: OpenRouterConnection,
  gloo: GlooConnection,
): string[] {
  return [
    session.tokenHash,
    github.installationId,
    github.githubLogin,
    openrouter.apiKeyCiphertext,
    openrouter.keyLast4,
    gloo.clientId,
    gloo.clientSecretCiphertext,
  ];
}

// GithubConnection must NOT expose any long-lived token field (§2.3).
export function noTokenColumn(github: GithubConnection): unknown {
  // @ts-expect-error GithubConnection has no `token` field — only installationId
  return github.token;
}
