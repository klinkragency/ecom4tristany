# Shop — Single-Shop Shopify-like Ecommerce

Greenfield ecommerce platform built with **Go** (chi + pgx + sqlc + goose) and **Next.js** (App Router + Bun).

- Complete feature inventory: [`FEATURES.md`](FEATURES.md)
- Phased roadmap + Phase 1 plan: `~/.claude/plans/i-want-to-create-replicated-scone.md`

## Status

**Phase 1 — Foundation** (in progress). Provides:
- Monorepo scaffold
- Postgres (via Docker)
- Go API with admin + customer authentication (sessions + CSRF)
- Next.js admin shell (login + 8 placeholder sections)
- Next.js storefront shell (landing + account registration/login)
- CI with lint + test + build

No catalog, cart, checkout, or orders yet — those are Phase 2+.

## Prerequisites

- Go 1.25+
- Bun 1.3+
- Docker Desktop
- `sqlc`, `goose`, `task`, `air` (install commands below)

```bash
brew install oven-sh/bun/bun sqlc goose go-task
go install github.com/air-verse/air@latest
```

## Quick start

```bash
# 1. Clone + install deps
bun install
cd backend && go mod download && cd ..

# 2. Copy env
cp .env.example .env

# 3. Start Postgres + run migrations
task db:up
task migrate:up

# 4. Seed the first admin
task seed:admin -- --email=admin@shop.test --password=changeme

# 5. Start everything (backend + admin + storefront)
task dev
```

Then open:
- Admin: http://localhost:3001 (login with seeded admin)
- Storefront: http://localhost:3000
- API: http://localhost:8080

## Repo layout

```
/
├── backend/              # Go API (chi, pgx, sqlc, goose)
├── admin/                # Next.js admin
├── storefront/           # Next.js public storefront
├── packages/shared/      # shared TS types
├── e2e/                  # Playwright smoke tests
├── docker-compose.yml
├── Taskfile.yml          # `task --list` to see commands
└── FEATURES.md           # full feature spec (all 14 areas)
```

## Common tasks

| Command | Does |
|---|---|
| `task db:up` | Start Postgres in Docker |
| `task db:reset` | Drop + recreate DB |
| `task migrate:up` | Apply pending migrations |
| `task migrate:new -- add_foo` | Create new migration |
| `task sqlc` | Regenerate Go code from SQL |
| `task dev` | Run backend + admin + storefront |
| `task test` | Run all tests |
| `task build` | Build everything |

## Security notes

- Session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in prod.
- Separate cookie names for admin (`__Host-admin_sid`) and customer (`__Host-cust_sid`).
- CSRF token required on all state-changing requests.
- Passwords: argon2id.
- First admin is created via a CLI one-off (`task seed:admin`), not a public endpoint.
