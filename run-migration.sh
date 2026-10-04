#!/bin/bash

# Run a specific migration
# Usage: ./run-migration.sh <migration_file>

# Get the migration file from argument or default to 003
MIGRATION_FILE="${1:-migrations/003_feature_toggles.sql}"

echo "Running migration: $MIGRATION_FILE"

# Get the database URL from environment or use default
DB_URL="${SUPABASE_DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "Error: SUPABASE_DATABASE_URL environment variable is not set"
  exit 1
fi

# Run the migration
psql "$DB_URL" -f "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
  echo "Migration completed successfully"
else
  echo "Migration failed"
  exit 1
fi
