#!/usr/bin/env bash
#
# Everything CI runs, locally, in one command.
#
# Written after a `cmd >/dev/null && echo "✓"` chain let a failing typecheck
# through without a word: under `set -e`, a command on the left of `&&` is a
# tested condition rather than a failure, so the script sailed past it. Here
# every step is run on its own line and its exit code checked explicitly, so a
# failure stops the run and says which step it was.
set -u

failed=""

step() {
  local name="$1"
  shift
  printf '%-34s' "$name"
  if "$@" >/tmp/verify-step.log 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    failed="$failed $name"
    tail -20 /tmp/verify-step.log | sed 's/^/    /'
  fi
}

export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-placeholder}"

step typecheck            npm run typecheck
step format               npm run format:check
step lint                 npm run lint
step build                npm run build
step "connection strings" npm run test:parse
step "wizard routes"      npm run test:routes
step "india time"         npm run test:time
step "cover start"        npm run test:cover-start
step parsers              npm run test:parsing
step "deviations + burn"  npm run test:members
step "rfq workbook"       npm run test:rfq
step "policy reader"      npm run test:extraction
step "policy facts"       npm run test:policy-facts
step typefaces            npm run test:fonts

if [ -n "${DATABASE_URL:-}" ]; then
  step "migrations"           npx tsx scripts/migrate.ts --reset
  step "migrations vs dirty"  npm run test:migrations
  step "database assertions"  npm run db:test
  step "term writes"          npm run test:term-writes
  step "guardrails import"    npm run db:import-guardrails
  step "import is idempotent" npm run db:import-guardrails
else
  echo "DATABASE_URL unset — skipping the database steps."
fi

if [ -n "$failed" ]; then
  echo
  echo "FAILED:$failed"
  exit 1
fi

echo
echo "everything passed."
