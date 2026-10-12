BEGIN;

-- ==========================================
-- 1. PLANS
-- ==========================================

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_account_id UUID,

    name VARCHAR(100) NOT NULL,

    plan_type VARCHAR(20) NOT NULL
        CHECK (plan_type IN ('ACCOUNT', 'USER')),

    is_predefined BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT plans_ownership_check CHECK (
        (is_predefined = TRUE AND owner_account_id IS NULL)
        OR
        (is_predefined = FALSE AND owner_account_id IS NOT NULL)
    )
);


-- ==========================================
-- 2. PLAN RULES
-- ==========================================

CREATE TABLE plan_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_id UUID NOT NULL UNIQUE
        REFERENCES plans(id) ON DELETE CASCADE,

    monthly_allowance BIGINT NOT NULL
        CHECK (monthly_allowance >= 0),

    max_units_per_request BIGINT NOT NULL
        CHECK (max_units_per_request > 0)
);


-- ==========================================
-- 3. ACCOUNTS
-- ==========================================

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name VARCHAR(100) NOT NULL,

    api_key_hash TEXT NOT NULL UNIQUE,

    plan_id UUID NOT NULL
        REFERENCES plans(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Add circular ownership relationship
ALTER TABLE plans
ADD CONSTRAINT plans_owner_account_fk
FOREIGN KEY (owner_account_id)
REFERENCES accounts(id);


-- ==========================================
-- 4. USERS
-- ==========================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id UUID NOT NULL
        REFERENCES accounts(id),

    external_user_id VARCHAR(100) NOT NULL,

    plan_id UUID NOT NULL
        REFERENCES plans(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_account_external_id_unique
        UNIQUE (account_id, external_user_id),

    CONSTRAINT users_account_id_id_unique
        UNIQUE (account_id, id)
);


-- ==========================================
-- 5. USAGE COUNTERS
-- ==========================================

CREATE TABLE usage_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id UUID NOT NULL
        REFERENCES accounts(id),

    user_id UUID,

    month_start DATE NOT NULL,

    consumed_units BIGINT NOT NULL DEFAULT 0
        CHECK (consumed_units >= 0),

    CONSTRAINT usage_counters_month_check
        CHECK (EXTRACT(DAY FROM month_start) = 1),

    CONSTRAINT usage_counters_user_fk
        FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id)
);


-- Exactly one account counter per month
CREATE UNIQUE INDEX usage_account_month_unique
ON usage_counters (account_id, month_start)
WHERE user_id IS NULL;


-- Exactly one user counter per month
CREATE UNIQUE INDEX usage_user_month_unique
ON usage_counters (account_id, user_id, month_start)
WHERE user_id IS NOT NULL;


-- ==========================================
-- 6. CONSUMPTION REQUESTS
-- ==========================================

CREATE TABLE consumption_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id UUID NOT NULL
        REFERENCES accounts(id),

    user_id UUID NOT NULL,

    request_id VARCHAR(100) NOT NULL,

    units BIGINT NOT NULL
        CHECK (units > 0),

    accepted BOOLEAN NOT NULL,

    rejection_scope VARCHAR(20)
        CHECK (
            rejection_scope IS NULL
            OR rejection_scope IN ('ACCOUNT', 'USER')
        ),

    rejection_rule VARCHAR(50),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT consumption_requests_user_fk
        FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id),

    CONSTRAINT consumption_requests_unique_request
        UNIQUE (account_id, request_id),

    CONSTRAINT consumption_requests_decision_check
        CHECK (
            (accepted = TRUE
             AND rejection_scope IS NULL
             AND rejection_rule IS NULL)
            OR
            (accepted = FALSE
             AND rejection_scope IS NOT NULL
             AND rejection_rule IS NOT NULL)
        )
);


-- ==========================================
-- 7. INDEXES
-- ==========================================

CREATE INDEX idx_users_account
ON users(account_id);

CREATE INDEX idx_consumption_requests_account_date
ON consumption_requests(account_id, created_at DESC);

CREATE INDEX idx_consumption_requests_user_date
ON consumption_requests(user_id, created_at DESC);

CREATE INDEX idx_plans_owner
ON plans(owner_account_id);


-- ==========================================
-- 8. PREDEFINED ACCOUNT PLANS
-- ==========================================

WITH starter AS (
    INSERT INTO plans (
        name,
        plan_type,
        is_predefined
    )
    VALUES ('Starter', 'ACCOUNT', TRUE)
    RETURNING id
)
INSERT INTO plan_rules (
    plan_id,
    monthly_allowance,
    max_units_per_request
)
SELECT id, 10000, 100
FROM starter;


WITH pro AS (
    INSERT INTO plans (
        name,
        plan_type,
        is_predefined
    )
    VALUES ('Pro', 'ACCOUNT', TRUE)
    RETURNING id
)
INSERT INTO plan_rules (
    plan_id,
    monthly_allowance,
    max_units_per_request
)
SELECT id, 50000, 500
FROM pro;


-- ==========================================
-- 9. PREDEFINED USER PLANS
-- ==========================================

WITH basic AS (
    INSERT INTO plans (
        name,
        plan_type,
        is_predefined
    )
    VALUES ('Basic', 'USER', TRUE)
    RETURNING id
)
INSERT INTO plan_rules (
    plan_id,
    monthly_allowance,
    max_units_per_request
)
SELECT id, 1000, 20
FROM basic;


WITH premium AS (
    INSERT INTO plans (
        name,
        plan_type,
        is_predefined
    )
    VALUES ('Premium', 'USER', TRUE)
    RETURNING id
)
INSERT INTO plan_rules (
    plan_id,
    monthly_allowance,
    max_units_per_request
)
SELECT id, 3000, 50
FROM premium;

COMMIT;