#!/bin/bash

# Run the feature toggles migration
# This script applies the 003_feature_toggles.sql migration to the database

echo "Running feature toggles migration..."

# Get the database URL from environment or use default
DB_URL="${SUPABASE_DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "Error: SUPABASE_DATABASE_URL environment variable is not set"
  exit 1
fi

# Run the migration
psql "$DB_URL" -f migrations/003_feature_toggles.sql

if [ $? -eq 0 ]; then
  echo "Migration completed successfully"
else
  echo "Migration failed"
  exit 1
fi
