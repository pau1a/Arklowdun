# Domain Models

All domain records belong to a household. The `household` table stores each group's identity:

```sql
CREATE TABLE household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
```

Each domain table includes a `household_id` foreign key referencing `household(id)` and an index on `(household_id, updated_at)` to scope queries efficiently.

Currently the application seeds a single default household, but the schema supports multiple households. Future work will expose UI and APIs for switching between households and sharing data across them.

Current tables include `events`, `bills`, `policies`, `property_documents`, `inventory_items`, `vehicles`, `vehicle_maintenance`,
`pets`, `pet_medical`, `family_members`, `budget_categories`, and `expenses`. Date-related columns are stored as INTEGER milliseconds
since the Unix epoch.
