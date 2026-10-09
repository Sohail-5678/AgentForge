-- One-off data cleanup (2026-10-09): two real-agent test runs whose scores reflected Groq free-tier rate limits
-- (HTTP 429 on 8K tokens/min), not agent quality — #389 ReturnPilot and #390 DataPilot. Results cascade with the run.
DELETE FROM traces WHERE run_id IN ('17465bd3-6b11-4caf-99a5-4ddc5eed1a80', 'e5ff58d6-84d5-46bc-9b79-05ce0b9e19ca');
DELETE FROM runs WHERE id IN ('17465bd3-6b11-4caf-99a5-4ddc5eed1a80', 'e5ff58d6-84d5-46bc-9b79-05ce0b9e19ca');
INSERT INTO audit_log (actor, action, object_type, object_id, details)
VALUES ('migration', 'runs.delete', 'run', '389,390', '{"reason": "free-tier rate-limited test runs (Groq 429)"}');
