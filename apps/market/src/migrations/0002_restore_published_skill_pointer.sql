-- Older submissions advanced current_version_id while a published release
-- remained visible through the published-version fallback. Restore that exact
-- fallback as the canonical pointer so resource-level deprecation stays safe.
UPDATE market_resources r
SET current_version_id = (
  SELECT pv.id FROM market_versions pv
  WHERE pv.resource_id = r.id AND pv.workflow_state = 'published'
  ORDER BY pv.created_at DESC, pv.id DESC LIMIT 1
)
WHERE r.type = 'skill' AND r.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM market_versions cv
    WHERE cv.id = r.current_version_id AND cv.resource_id = r.id
      AND cv.workflow_state = 'published'
  )
  AND EXISTS (
    SELECT 1 FROM market_versions pv
    WHERE pv.resource_id = r.id AND pv.workflow_state = 'published'
  );
