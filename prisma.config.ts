import { defineConfig } from "prisma/config";

// Prisma 7 config for the CLI (migrate / validate / studio). The `datasource`
// block in schema.prisma cannot carry a `url` (P1012), so migration and
// introspection commands read the connection string from here instead.
//
// DATABASE_URL is taken from the environment. Prisma 7 does not auto-load .env,
// so we load it ourselves — no `dotenv` dependency, using Node's built-in
// loader (Node 20.12+/21.7+). An already-set env var wins over the file, and a
// missing .env is fine (guarded). See .env.example for the local default.
try {
  process.loadEnvFile();
} catch {
  // No local .env — rely on the ambient environment (CI, Compose, shell export).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
