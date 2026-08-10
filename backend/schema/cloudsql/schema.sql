-- KatalogitAI — Cloud SQL (PostgreSQL) schema
-- Scope: credit ledger, wallets, top-up orders, per-op pricing,
-- subscriptions (monthly plans) and referrals.
-- Everything financial/credit lives here (ACID); catalogue lives in Firestore.
--
-- IDEMPOTENCY KEY CONVENTION (critical — never collide):
--   CONSUME → 'job:'  || jobId || ':consume'
--   REFUND  → 'REFUND:' || jobId          (one refund per job, enforced)
--   TOPUP   → 'rzp:'  || paymentId
--   GRANT   → 'GRANT:' || refId           (signup: refId = storeId)
--   EXPIRY  → 'EXPIRY:' || periodId
--   ADJUST  → 'ADJUST:' || adminRef
-- The functions below namespace keys automatically, so callers can't collide.

BEGIN;

CREATE TABLE IF NOT EXISTS wallets (
  store_id       TEXT PRIMARY KEY,
  balance        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_used  NUMERIC(12,2) NOT NULL DEFAULT 0,
  plan           TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business')),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL REFERENCES wallets(store_id),
  type            TEXT NOT NULL CHECK (type IN ('GRANT','TOPUP','CONSUME','REFUND','EXPIRY','ADJUST')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount <> 0),  -- signed: +credit / −debit
  balance_after   NUMERIC(12,2) NOT NULL,
  reference_type  TEXT,                            -- job | order | admin | signup | referral | period
  reference_id    TEXT,
  idempotency_key TEXT NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Hard guarantee against double-charges / duplicate webhook deliveries
  UNIQUE (store_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_store_time ON ledger (store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  order_id        TEXT PRIMARY KEY,                -- rzp_order_xxx
  store_id        TEXT NOT NULL,
  pack_id         TEXT,                            -- 'pack_100' | 'pack_500' | subscription plan id
  credits         NUMERIC(12,2) NOT NULL CHECK (credits > 0),
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  currency        TEXT NOT NULL DEFAULT 'INR',
  status          TEXT NOT NULL DEFAULT 'created'
                  CHECK (status IN ('created','paid','failed','refunded')),
  rzp_payment_id  TEXT,
  -- Key is available at insert time because the API receives rzp_order_id
  -- before persisting the row. 'rzp:{payment_id}' is reserved for the
  -- wallet top-up in the ledger (different table → no collision).
  idempotency_key TEXT NOT NULL UNIQUE,            -- 'order:{rzp_order_id}'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pricing (
  op_key   TEXT PRIMARY KEY,                       -- model_shoot | regen_shot | full_regen | retake
  credits  NUMERIC(12,2) NOT NULL CHECK (credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monthly plans (Pro/Business). Credit grants + expiry are driven off this.
CREATE TABLE IF NOT EXISTS subscriptions (
  store_id        TEXT PRIMARY KEY REFERENCES wallets(store_id),
  plan            TEXT NOT NULL CHECK (plan IN ('pro','business')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due')),
  rzp_subscription_id TEXT,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  monthly_credits NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One referral grant per pair (inviter, invitee) — dedup enforced by PK.
CREATE TABLE IF NOT EXISTS referrals (
  inviter_store_id TEXT NOT NULL REFERENCES wallets(store_id),
  invitee_store_id TEXT NOT NULL REFERENCES wallets(store_id),
  bonus_credits    NUMERIC(12,2) NOT NULL,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (inviter_store_id, invitee_store_id)
);

-- Seed pricing (matches frontend ReviewPDP / AddProductFlow operations)
INSERT INTO pricing (op_key, credits) VALUES
  ('model_shoot', 3),
  ('regen_shot',  1),
  ('full_regen',  3),
  ('retake',      0)
ON CONFLICT (op_key) DO NOTHING;

-- Atomic reserve: deduct `credits` from a store wallet if sufficient balance.
-- Creates the wallet first if missing (race-safe). Returns new balance, or
-- NULL when the reservation fails. Idempotency key = 'job:{jobId}:consume'.
CREATE OR REPLACE FUNCTION reserve_credits(
  p_store_id TEXT, p_amount NUMERIC, p_job_id TEXT, p_note TEXT
) RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  -- Ensure the wallet exists (idempotent, race-safe)
  INSERT INTO wallets (store_id) VALUES (p_store_id)
    ON CONFLICT (store_id) DO NOTHING;

  -- Row lock the wallet so concurrent reservations serialize
  SELECT balance INTO new_balance FROM wallets WHERE store_id = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF new_balance < p_amount THEN
    RETURN NULL; -- insufficient credits
  END IF;

  new_balance := new_balance - p_amount;
  UPDATE wallets SET balance = new_balance, lifetime_used = lifetime_used + p_amount,
                     updated_at = now()
   WHERE store_id = p_store_id;

  INSERT INTO ledger (store_id, type, amount, balance_after, reference_type,
                      reference_id, idempotency_key, note)
  VALUES (p_store_id, 'CONSUME', -p_amount, new_balance, 'job', p_job_id,
          'job:' || p_job_id || ':consume', p_note);

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Atomic credit grant (signup bonus, refund, referral, admin adjust, top-up).
-- Amount always positive. Idempotency key = '{TYPE}:{refId}' — a refund uses
-- 'REFUND:{jobId}', which can never collide with the CONSUME key above.
CREATE OR REPLACE FUNCTION grant_credits(
  p_store_id TEXT, p_type TEXT, p_amount NUMERIC, p_ref_id TEXT, p_note TEXT
) RETURNS NUMERIC AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  IF p_type NOT IN ('GRANT','TOPUP','REFUND','ADJUST') THEN
    RAISE EXCEPTION 'grant_credits: type must be GRANT/TOPUP/REFUND/ADJUST (got %)', p_type;
  END IF;

  INSERT INTO wallets (store_id) VALUES (p_store_id)
    ON CONFLICT (store_id) DO NOTHING;

  SELECT balance INTO new_balance FROM wallets WHERE store_id = p_store_id FOR UPDATE;
  new_balance := new_balance + p_amount;
  UPDATE wallets SET balance = new_balance, updated_at = now()
   WHERE store_id = p_store_id;

  INSERT INTO ledger (store_id, type, amount, balance_after, reference_type,
                      reference_id, idempotency_key, note)
  VALUES (p_store_id, p_type, p_amount, new_balance,
          CASE p_type WHEN 'TOPUP' THEN 'order' WHEN 'GRANT' THEN 'signup' ELSE 'admin' END,
          p_ref_id, p_type || ':' || p_ref_id, p_note);

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

COMMIT;
