-- Supabase Schema for the Game

-- Create the users table for balance persistence
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT,
    photo_url TEXT,
    first_name TEXT,
    last_name TEXT,
    balance NUMERIC DEFAULT 100000,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Safely add columns in case the table already exists
DO $$
BEGIN
    BEGIN
        ALTER TABLE users ADD COLUMN photo_url TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN first_name TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN last_name TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN phone TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT false;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en';
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN referrer_id TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN bank_name TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN bank_account TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    BEGIN
        ALTER TABLE users ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- Enable Realtime for the users table
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime;
COMMIT;
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- Create the transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the game_logs table for Chance and Jackpot
CREATE TABLE IF NOT EXISTS game_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    game_type TEXT NOT NULL,
    result TEXT,
    win_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the rounds table
CREATE TABLE IF NOT EXISTS rounds (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    round_number INTEGER NOT NULL,
    winner INTEGER,
    pools_even NUMERIC DEFAULT 0,
    pools_odd NUMERIC DEFAULT 0,
    room_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the bets table
CREATE TABLE IF NOT EXISTS bets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    round_id UUID REFERENCES rounds(id),
    user_id TEXT NOT NULL,
    username TEXT,
    amount NUMERIC NOT NULL,
    side TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create the bot_config table for dynamic settings
CREATE TABLE IF NOT EXISTS bot_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Insert default AI instructions if not exists
INSERT INTO bot_config (key, value)
VALUES ('ai_system_instruction', 'You are the primary AI Support Assistant for ETB Game Hub. Provide helpful, polite, and accurate support in Amharic and English.')
ON CONFLICT (key) DO NOTHING;

-- ==============================================================================
-- PERFORMANCE OPTIMIZATION: INDEXES
-- These indexes significantly improve query speeds for transaction/log lookups.
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_logs_user_id ON game_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_game_logs_created_at ON game_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_room_id ON rounds (room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_created_at ON rounds (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets (round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets (user_id);

-- ==============================================================================
-- PERFORMANCE OPTIMIZATION: ATOMIC BALANCE MODIFICATIONS
-- Creating this RPC drastically improves backend performance by executing
-- balance checks, updates, and transaction logging in a single atomic database trip.
-- ==============================================================================
CREATE OR REPLACE FUNCTION modify_balance(
    p_user_id TEXT,
    p_amount NUMERIC,
    p_tx_type TEXT,
    p_tx_desc TEXT
) RETURNS jsonb AS $$
DECLARE
    curr_balance NUMERIC;
    new_balance NUMERIC;
BEGIN
    -- Lock row to prevent race conditions during concurrent updates
    SELECT balance INTO curr_balance FROM users WHERE id = p_user_id FOR UPDATE;
    IF curr_balance IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    new_balance := curr_balance + p_amount;
    IF p_amount < 0 AND new_balance < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;

    UPDATE users SET balance = new_balance WHERE id = p_user_id;

    IF p_amount <> 0 THEN
        INSERT INTO transactions (user_id, amount, type, description)
        VALUES (p_user_id, p_amount, p_tx_type, p_tx_desc);
    END IF;

    RETURN jsonb_build_object('success', true, 'newBalance', new_balance);
END;
$$ LANGUAGE plpgsql;

-- Add is_blocked_bot flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked_bot BOOLEAN DEFAULT FALSE;
