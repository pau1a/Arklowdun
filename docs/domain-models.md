# Domain Models

This document enumerates the core entities persisted by the application.
All identifiers are UUID strings stored as `TEXT`. Timestamps are epoch
milliseconds stored as `INTEGER`. Soft deletions use a `deleted_at`
timestamp which is `NULL` when the record is active.

## household
- `id` `TEXT` – primary key
- `name` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## events
- `id` `TEXT`
- `household_id` `TEXT`
- `title` `TEXT`
- `starts_at` `INTEGER`
- `reminder` `INTEGER?`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## bills
- `id` `TEXT`
- `amount` `INTEGER` – minor currency units
- `due_date` `INTEGER`
- `root_key` `TEXT`
- `relative_path` `TEXT`
- `reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## policies
- `id` `TEXT`
- `amount` `INTEGER` – minor currency units
- `due_date` `INTEGER`
- `root_key` `TEXT`
- `relative_path` `TEXT`
- `reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## property_documents
- `id` `TEXT`
- `description` `TEXT`
- `renewal_date` `INTEGER`
- `root_key` `TEXT`
- `relative_path` `TEXT`
- `reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## inventory_items
- `id` `TEXT`
- `name` `TEXT`
- `purchase_date` `INTEGER`
- `warranty_expiry` `INTEGER`
- `document` `TEXT`
- `reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## vehicles
- `id` `TEXT`
- `name` `TEXT`
- `mot_date` `INTEGER`
- `service_date` `INTEGER`
- `mot_reminder` `INTEGER?`
- `service_reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## vehicle_maintenance
- `id` `TEXT`
- `vehicle_id` `TEXT`
- `date` `INTEGER`
- `type` `TEXT`
- `cost` `INTEGER`
- `document` `TEXT`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## pets
- `id` `TEXT`
- `name` `TEXT`
- `type` `TEXT`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## pet_medical
- `id` `TEXT`
- `pet_id` `TEXT`
- `date` `INTEGER`
- `description` `TEXT`
- `document` `TEXT`
- `reminder` `INTEGER?`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## family_members
- `id` `TEXT`
- `name` `TEXT`
- `birthday` `INTEGER`
- `notes` `TEXT`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## budget_categories
- `id` `TEXT`
- `name` `TEXT`
- `monthly_budget` `INTEGER`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

## expenses
- `id` `TEXT`
- `category_id` `TEXT`
- `amount` `INTEGER`
- `date` `INTEGER`
- `description` `TEXT`
- `household_id` `TEXT`
- `created_at` `INTEGER`
- `updated_at` `INTEGER`
- `deleted_at` `INTEGER?`

