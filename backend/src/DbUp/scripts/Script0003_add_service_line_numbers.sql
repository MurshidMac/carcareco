-- The service subtype tables previously carried no ordering column, so service
-- lines could not be numbered the way product lines are. Add one to both so a
-- single, interleaved line order can be persisted across products and services.
-- Both tables were unused before this change, so the default is only a
-- formality for any pre-existing (impossible) rows.

ALTER TABLE IF EXISTS domain.serviceoffered
    ADD COLUMN IF NOT EXISTS jnr smallint NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS domain.serviceperformed
    ADD COLUMN IF NOT EXISTS jnr smallint NOT NULL DEFAULT 0;
