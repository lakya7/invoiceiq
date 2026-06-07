-- Extend invoices_status_check to cover ALL status values the application writes.
--
-- Context: the original constraint only allowed ('pending','approved','rejected','pushed').
-- The app had drifted to write additional statuses (paid, partially_paid, rejected_duplicate,
-- validation_failed, needs_review) and the new outcome-based statuses (review, push_uncertain).
-- Values not in the constraint caused INSERTs to fail SILENTLY (the save code ignored the
-- supabase error field), so failed/rejected invoices could vanish with no row and no log.
--
-- This migration was ALREADY APPLIED MANUALLY to prod (cwsubqfynnntrzfshldy) on 2026-06-07.
-- It is captured here to version-control the schema and stop adding to the drift that caused
-- the bug. Safe to re-run (DROP IF EXISTS + ADD).

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'pushed',
    'paid',
    'partially_paid',
    'needs_review',
    'rejected_duplicate',
    'review',
    'push_uncertain',
    'validation_failed'
  ));
