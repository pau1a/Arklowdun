ALTER TABLE pets ADD COLUMN image_path TEXT;
CREATE INDEX IF NOT EXISTS pets_household_image_idx ON pets(household_id, image_path);
