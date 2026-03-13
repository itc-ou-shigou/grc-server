-- 013_model_key_api_type.sql — Add api_type to ai_model_keys
-- Allows explicit WinClaw API type (e.g. anthropic-messages, openai-completions)
-- to be stored with each key and delivered via key_config.

ALTER TABLE ai_model_keys
  ADD COLUMN api_type VARCHAR(50) DEFAULT NULL
    COMMENT 'WinClaw API type: anthropic-messages, openai-completions, google-generative-ai, bedrock-converse-stream, ollama'
    AFTER base_url;
