-- HR UNIVERSE
-- Migration 0009: Bind idempotency keys to the original order request.
-- Additive only; existing orders remain readable. New requests store a SHA-256
-- fingerprint so accidental key reuse with a different payload is rejected.

ALTER TABLE orders ADD COLUMN idempotency_request_hash TEXT;
