import unittest

from backend.main import MODEL_CATALOG, validate_model


class ModelSettingsTests(unittest.TestCase):
    def test_catalog_has_both_local_providers(self) -> None:
        self.assertEqual(set(MODEL_CATALOG), {"codex", "claude"})

    def test_accepts_supported_codex_settings(self) -> None:
        validate_model("codex", "gpt-5.6-sol", "low")

    def test_accepts_supported_claude_settings(self) -> None:
        validate_model("claude", "claude-sonnet-5", "medium")

    def test_rejects_unknown_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "not available"):
            validate_model("codex", "unknown", "low")

    def test_rejects_unsupported_reasoning(self) -> None:
        with self.assertRaisesRegex(ValueError, "not available"):
            validate_model("claude", "claude-haiku-4-5", "high")


if __name__ == "__main__":
    unittest.main()
