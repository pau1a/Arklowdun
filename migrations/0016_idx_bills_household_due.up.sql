-- Speed due_date range queries by (household_id, due_date)
CREATE INDEX IF NOT EXISTS idx_bills_household_due
  ON bills(household_id, due_date);
