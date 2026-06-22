-- ONCHYRA PostgreSQL Schema (no FK constraints - added after migration)

-- Users
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY, email TEXT, name TEXT, device_id TEXT,
  balance NUMERIC DEFAULT 0, status TEXT DEFAULT 'active',
  referral_code TEXT, referred_by TEXT, referrals INT DEFAULT 0,
  ref_level1 INT DEFAULT 0, ref_level2 INT DEFAULT 0, ref_level3 INT DEFAULT 0,
  total_package_spend NUMERIC DEFAULT 0, team_biz NUMERIC DEFAULT 0,
  leg_a_biz NUMERIC DEFAULT 0, leg_b_biz NUMERIC DEFAULT 0,
  team_business NUMERIC DEFAULT 0, total_directs INT DEFAULT 0,
  active_directs INT DEFAULT 0, commission_balance NUMERIC DEFAULT 0,
  wallet_balance NUMERIC DEFAULT 0, total_deposits NUMERIC DEFAULT 0,
  total_claimed NUMERIC DEFAULT 0, total_commissions NUMERIC DEFAULT 0,
  total_matching_bonus NUMERIC DEFAULT 0, streak INT DEFAULT 0,
  last_claim BIGINT, active_package TEXT, package_amount NUMERIC DEFAULT 0,
  package_boost NUMERIC DEFAULT 0, package_cap NUMERIC DEFAULT 0,
  package_usage NUMERIC DEFAULT 0, package_status TEXT DEFAULT 'none',
  package_purchased_at BIGINT, rank TEXT DEFAULT 'Unranked',
  rank_calculated_at BIGINT, rank_achievements TEXT,
  achievement_bonus_claimed BOOLEAN DEFAULT FALSE,
  leadership_reward_rank TEXT, leadership_reward_day INT DEFAULT 0,
  leadership_reward_days INT DEFAULT 0, leadership_reward_payouts INT DEFAULT 0,
  leadership_reward_start BIGINT, reward_last_paid TEXT,
  reward_checked_at BIGINT, reward_next_at BIGINT,
  reward_processed BOOLEAN DEFAULT FALSE, banned BOOLEAN DEFAULT FALSE,
  is_safe BOOLEAN DEFAULT TRUE, leader_status TEXT DEFAULT '',
  verified_leader BOOLEAN DEFAULT FALSE, admin_notes JSONB DEFAULT '[]',
  promotional_package BOOLEAN DEFAULT FALSE,
  promotional_account BOOLEAN DEFAULT FALSE,
  promotional_comm_excluded BOOLEAN DEFAULT FALSE, country TEXT,
  email_sent BOOLEAN DEFAULT FALSE, last_email_sent_at BIGINT,
  role TEXT DEFAULT 'user', created_at BIGINT, updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Admins
CREATE TABLE IF NOT EXISTS admins (uid TEXT PRIMARY KEY, role TEXT DEFAULT 'admin');

-- Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY, uid TEXT, amount NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0,
  net_amount NUMERIC DEFAULT 0, wallet TEXT, network TEXT DEFAULT 'BEP20',
  status TEXT DEFAULT 'pending', tx_hash TEXT, created_at BIGINT,
  completed_at BIGINT, approved_at BIGINT, rejected_at BIGINT, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_uid ON withdrawals(uid);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY, uid TEXT, address TEXT, network TEXT,
  amount NUMERIC DEFAULT 0, tx_hash TEXT, status TEXT DEFAULT 'completed',
  token TEXT DEFAULT 'USDT', pol_amount NUMERIC DEFAULT 0,
  pol_price NUMERIC DEFAULT 0, detected_at BIGINT, confirmed_at BIGINT, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_deposits_uid ON deposits(uid);

-- Deposit Wallets
CREATE TABLE IF NOT EXISTS deposit_wallets (
  id TEXT PRIMARY KEY, uid TEXT, network TEXT, address TEXT, path TEXT,
  index INT DEFAULT 0, used BOOLEAN DEFAULT FALSE, tx_hash TEXT,
  created_at BIGINT, used_at BIGINT, checked_at BIGINT,
  swept BOOLEAN DEFAULT FALSE, swept_at BIGINT, sweep_tx TEXT,
  expired BOOLEAN DEFAULT FALSE, expired_at BIGINT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_deposit_wallets_uid ON deposit_wallets(uid);
CREATE INDEX IF NOT EXISTS idx_deposit_wallets_address ON deposit_wallets(address);

-- Package Purchases
CREATE TABLE IF NOT EXISTS package_purchases (
  id TEXT PRIMARY KEY, uid TEXT, package_id TEXT, name TEXT,
  amount NUMERIC DEFAULT 0, paid NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0,
  boost NUMERIC DEFAULT 0, admin_activated BOOLEAN DEFAULT FALSE,
  activated_by TEXT, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_package_purchases_uid ON package_purchases(uid);

-- Commissions
CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY, uid TEXT, from_uid TEXT, to_uid TEXT,
  amount NUMERIC DEFAULT 0, level INT DEFAULT 1, type TEXT,
  package_name TEXT, from_name TEXT, admin_retro BOOLEAN DEFAULT FALSE, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_commissions_uid ON commissions(uid);
CREATE INDEX IF NOT EXISTS idx_commissions_from_uid ON commissions(from_uid);

-- Achievement Bonuses
CREATE TABLE IF NOT EXISTS achievement_bonuses (
  id TEXT PRIMARY KEY, uid TEXT, rank TEXT, amount NUMERIC DEFAULT 0,
  type TEXT DEFAULT 'achievement', created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_achievement_bonuses_uid ON achievement_bonuses(uid);

-- Leadership Rewards
CREATE TABLE IF NOT EXISTS leadership_rewards (
  id TEXT PRIMARY KEY, uid TEXT, rank TEXT, amount NUMERIC DEFAULT 0,
  day INT DEFAULT 0, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_leadership_rewards_uid ON leadership_rewards(uid);

-- P2P Transfers
CREATE TABLE IF NOT EXISTS p2p_transfers (
  id TEXT PRIMARY KEY, from_uid TEXT, to_uid TEXT, from_code TEXT, to_code TEXT,
  from_name TEXT, to_name TEXT, gross_amount NUMERIC DEFAULT 0,
  burn NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'completed', created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_p2p_transfers_from ON p2p_transfers(from_uid);
CREATE INDEX IF NOT EXISTS idx_p2p_transfers_to ON p2p_transfers(to_uid);

-- Claims (Daily Mining)
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, user_id TEXT, previous_balance NUMERIC DEFAULT 0,
  claimed_balance NUMERIC DEFAULT 0, claimed_amount NUMERIC DEFAULT 0,
  previous_streak INT DEFAULT 0, claimed_streak INT DEFAULT 0,
  time_since_last_claim BIGINT, status TEXT DEFAULT 'completed',
  client_timestamp BIGINT, created_at BIGINT, uid TEXT, type TEXT, amount NUMERIC DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT, title TEXT, message TEXT,
  type TEXT DEFAULT 'update', link TEXT, read_by JSONB DEFAULT '[]', created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- Polls
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY, question TEXT, options JSONB DEFAULT '[]',
  results JSONB DEFAULT '{}', created_at BIGINT
);

-- Poll Votes
CREATE TABLE IF NOT EXISTS poll_votes (
  id TEXT PRIMARY KEY, uid TEXT, poll_id TEXT, choice TEXT, voted_for TEXT
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_uid ON poll_votes(uid);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON poll_votes(poll_id);

-- Updates
CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY, title TEXT, message TEXT, visible BOOLEAN DEFAULT TRUE,
  priority INT DEFAULT 0, created_at BIGINT
);

-- Admin Transactions
CREATE TABLE IF NOT EXISTS admin_transactions (
  id TEXT PRIMARY KEY, admin_id TEXT, target_user_id TEXT, target_user_name TEXT,
  amount NUMERIC DEFAULT 0, type TEXT, previous_balance NUMERIC DEFAULT 0,
  new_balance NUMERIC DEFAULT 0, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_admin_transactions_target ON admin_transactions(target_user_id);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, type TEXT, uid TEXT, amount NUMERIC DEFAULT 0,
  fee NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0, wallet TEXT, status TEXT, created_at BIGINT
);

-- Predictions
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, symbol TEXT, segment TEXT, seg TEXT,
  start_price NUMERIC DEFAULT 0, end_price NUMERIC DEFAULT 0,
  outcome TEXT, status TEXT DEFAULT 'active',
  total_bets INT DEFAULT 0, total_pool NUMERIC DEFAULT 0,
  up_pool NUMERIC DEFAULT 0, down_pool NUMERIC DEFAULT 0,
  up_count INT DEFAULT 0, down_count INT DEFAULT 0,
  start_time BIGINT, end_time BIGINT, asset_id TEXT,
  created_at BIGINT
);

-- Prediction Bets
CREATE TABLE IF NOT EXISTS prediction_bets (
  id TEXT PRIMARY KEY, user_id TEXT, round_id TEXT, amount NUMERIC DEFAULT 0,
  stake NUMERIC DEFAULT 0, payout NUMERIC DEFAULT 0, prediction TEXT,
  claimed BOOLEAN DEFAULT FALSE, cancelled BOOLEAN DEFAULT FALSE, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_prediction_bets_user ON prediction_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_prediction_bets_round ON prediction_bets(round_id);

-- Contests
CREATE TABLE IF NOT EXISTS contests (
  id TEXT PRIMARY KEY, name TEXT, active BOOLEAN DEFAULT TRUE,
  description TEXT, prizes JSONB DEFAULT '{}', rewards JSONB DEFAULT '{}',
  reward_pool NUMERIC DEFAULT 0, end_time BIGINT,
  start_time BIGINT, created_at BIGINT
);

-- Contest Participants
CREATE TABLE IF NOT EXISTS contest_participants (
  id TEXT PRIMARY KEY, contest_id TEXT, user_id TEXT, wallet_address TEXT,
  join_time BIGINT, join_referrals INT DEFAULT 0,
  join_ref_level1 INT DEFAULT 0, join_ref_level2 INT DEFAULT 0,
  join_ref_level3 INT DEFAULT 0, added_by_admin BOOLEAN DEFAULT FALSE,
  score_type TEXT DEFAULT 'l1', contest_referrals INT DEFAULT 0,
  winner_rank INT, payout_sent BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON contest_participants(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_participants_user ON contest_participants(user_id);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB);

-- OTPs
CREATE TABLE IF NOT EXISTS otps (
  id TEXT PRIMARY KEY, email TEXT, otp TEXT, purpose TEXT,
  created_at BIGINT, expires_at BIGINT, verified BOOLEAN DEFAULT FALSE,
  attempts INT DEFAULT 0, used_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email);

-- OTP Store
CREATE TABLE IF NOT EXISTS otp_store (
  email TEXT PRIMARY KEY, otp TEXT, purpose TEXT, created_at BIGINT,
  expires_at BIGINT, cooldown_until BIGINT, verified BOOLEAN DEFAULT FALSE, attempts INT DEFAULT 0
);

-- OTP Logs
CREATE TABLE IF NOT EXISTS otp_logs (
  id TEXT PRIMARY KEY, email TEXT, purpose TEXT, event TEXT,
  provider TEXT, error TEXT, created_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_otp_logs_email ON otp_logs(email);

-- PowerDrops
CREATE TABLE IF NOT EXISTS powerdrops (
  id TEXT PRIMARY KEY, title TEXT, reward TEXT, winners INT DEFAULT 0,
  max_participants INT DEFAULT 0, participants_count INT DEFAULT 0,
  duration INT DEFAULT 7, winners_count INT DEFAULT 0, start_time BIGINT, created_at BIGINT
);

-- PowerDrop Participants
CREATE TABLE IF NOT EXISTS powerdrop_participants (
  id TEXT PRIMARY KEY, event_id TEXT, address TEXT, joined_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_powerdrop_participants_event ON powerdrop_participants(event_id);

-- Poll Log
CREATE TABLE IF NOT EXISTS poll_logs (
  id TEXT PRIMARY KEY, action TEXT, question TEXT, admin_email TEXT, created_at BIGINT
);
