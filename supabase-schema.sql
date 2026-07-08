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
