import asyncio
import unittest
from unittest import mock

from backend import main
from backend.main import AiRunResult, FollowupMessage, FollowupRequest
from backend.youtube import VideoContext

VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
VIDEO_ID = "dQw4w9WgXcQ"


def transcribed(transcript: str) -> VideoContext:
    context = VideoContext(title="A video", author="A channel", description="", duration_seconds=600)
    context.transcript = transcript
    context.transcript_language = "en"
    context.transcript_generated = False
    return context


class FollowupEndpointTests(unittest.TestCase):
    """Runs the endpoint with the CLI stubbed out, so the prompt it builds is
    observable without spending a provider run."""

    def setUp(self) -> None:
        main.context_cache.clear()
        self.addCleanup(main.context_cache.clear)

    def ask(self, question: str = "What about pricing?", history=None) -> str:
        captured: dict[str, str] = {}

        async def fake_run_provider(provider, video_url, context, model, reasoning, prompt=None):
            captured["prompt"] = prompt
            return AiRunResult(summary="An answer.", analysis_seconds=1.0, processing_seconds=0.1)

        request = FollowupRequest(
            url=VIDEO_URL,
            question=question,
            summary="## 1. Video Summary\n\nThe brief.",
            history=[FollowupMessage(**message) for message in (history or [])],
        )

        with mock.patch.object(main, "run_provider", fake_run_provider):
            response = asyncio.run(main.followup(request))

        self.assertEqual(response.answer, "An answer.")
        return captured["prompt"]

    def test_feeds_the_cached_transcript_into_the_prompt(self) -> None:
        main.remember_context(VIDEO_ID, transcribed("00:10 They discuss pricing."))

        prompt = self.ask()

        self.assertIn("BEGIN VIDEO TRANSCRIPT", prompt)
        self.assertIn("00:10 They discuss pricing.", prompt)

    def test_says_the_transcript_is_missing_when_nothing_was_cached(self) -> None:
        prompt = self.ask()

        self.assertNotIn("BEGIN VIDEO TRANSCRIPT", prompt)
        self.assertIn("transcript is not available in this session", prompt)

    def test_does_not_borrow_another_videos_transcript(self) -> None:
        main.remember_context("someOtherId", transcribed("00:10 A different video."))

        prompt = self.ask()

        self.assertNotIn("A different video.", prompt)
        self.assertIn("transcript is not available in this session", prompt)

    def test_carries_the_conversation_and_the_new_question(self) -> None:
        prompt = self.ask(
            question="And the second point?",
            history=[
                {"role": "user", "content": "What about pricing?"},
                {"role": "assistant", "content": "They cover it early."},
            ],
        )

        self.assertIn("Question: What about pricing?", prompt)
        self.assertIn("Your answer: They cover it early.", prompt)
        self.assertIn("New question: And the second point?", prompt)


class SummarizeFillsTheCacheTests(unittest.TestCase):
    """The transcript reaches follow-ups only if the analysis run stored it."""

    def setUp(self) -> None:
        main.context_cache.clear()
        self.addCleanup(main.context_cache.clear)

    def test_an_analysis_run_caches_the_context_it_fetched(self) -> None:
        context = transcribed("00:10 They discuss pricing.")

        async def fake_run_provider(provider, video_url, ctx, model, reasoning, prompt=None):
            return AiRunResult(summary="A brief.", analysis_seconds=1.0, processing_seconds=0.1)

        with (
            mock.patch.object(main, "fetch_video_context", return_value=context),
            mock.patch.object(main, "run_provider", fake_run_provider),
        ):
            asyncio.run(main.summarize(main.SummaryRequest(url=VIDEO_URL)))

        recalled = main.recall_context(VIDEO_ID)
        self.assertIsNotNone(recalled)
        self.assertEqual(recalled.transcript, "00:10 They discuss pricing.")


if __name__ == "__main__":
    unittest.main()
