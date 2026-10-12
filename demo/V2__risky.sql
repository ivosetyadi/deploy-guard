-- Demo migration for Deploy Guard
UPDATE users SET phone = normalize(phone) WHERE created_at < NOW();
DROP TABLE legacy_sessions;
