-- Review metadata can change on an identical-package resubmission.
-- Package contents and the live resource category remain unchanged.
ALTER TABLE market_versions ADD COLUMN suggested_category text;
