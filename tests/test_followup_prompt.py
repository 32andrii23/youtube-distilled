import unittest

from backend.prompt import (
    MAX_FOLLOWUP_HISTORY_MESSAGES,
    MAX_FOLLOWUP_MESSAGE_CHARS,
    MAX_FOLLOWUP_SUMMARY_CHARS,
    MAX_FOLLOWUP_TRANSCRIPT_CHARS,
    build_followup_prompt,
)
from backend.youtube import VideoContext


def transcribed(transcript: str) -> VideoContext:
    context = VideoContext(title="A video", author="A channel", description="", duration_seconds=600)
    context.transcript = transcript
    context.transcript_language = "en"
    context.transcript_generated = False
    return context


def build(summary: str = "The brief.", history=None, question: str = "What about pricing?", context=None) -> str:
    return build_followup_prompt(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        summary,
        history if history is not None else [],
        question,
        context,
    )


class TranscriptTests(unittest.TestCase):
    def test_includes_the_transcript_when_one_is_cached(self) -> None:
        prompt = build(context=transcribed("00:10 They discuss pricing."))
        self.assertIn("00:10 They discuss pricing.", prompt)
        self.assertIn("BEGIN VIDEO TRANSCRIPT", prompt)

    def test_says_plainly_when_no_transcript_is_available(self) -> None:
        prompt = build(context=None)
        self.assertNotIn("BEGIN VIDEO TRANSCRIPT", prompt)
        self.assertIn("transcript is not available in this session", prompt)
        self.assertIn("only cite timecodes that appear in the brief", prompt)

    def test_treats_a_context_without_captions_as_no_transcript(self) -> None:
        context = VideoContext(title="A video", author="A channel", description="", duration_seconds=600)
        context.transcript_error = "No caption track was exposed."
        prompt = build(context=context)
        self.assertNotIn("BEGIN VIDEO TRANSCRIPT", prompt)
        self.assertIn("transcript is not available in this session", prompt)

    def test_never_claims_sources_it_was_not_given(self) -> None:
        # The old wording promised "transcript, captions, chapters" unconditionally
        # while the endpoint supplied none of them.
        prompt = build(context=None)
        self.assertNotIn("Answer from the video itself: its transcript, captions, chapters", prompt)

    def test_trims_a_pathological_transcript(self) -> None:
        prompt = build(context=transcribed("x" * (MAX_FOLLOWUP_TRANSCRIPT_CHARS + 5_000)))
        self.assertIn("trimmed for length", prompt)
        self.assertLess(len(prompt), MAX_FOLLOWUP_TRANSCRIPT_CHARS + 4_000)


class HistoryTests(unittest.TestCase):
    def test_keeps_the_most_recent_exchanges_and_drops_the_oldest(self) -> None:
        history = [
            {"role": "user" if index % 2 == 0 else "assistant", "content": f"message {index}"}
            for index in range(MAX_FOLLOWUP_HISTORY_MESSAGES + 4)
        ]
        prompt = build(history=history)

        self.assertNotIn("message 0", prompt)
        self.assertNotIn("message 3", prompt)
        self.assertIn(f"message {MAX_FOLLOWUP_HISTORY_MESSAGES + 3}", prompt)
        self.assertIn("Earlier questions were dropped", prompt)

    def test_keeps_every_message_when_under_the_cap(self) -> None:
        history = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ]
        prompt = build(history=history)

        self.assertIn("first question", prompt)
        self.assertIn("first answer", prompt)
        self.assertNotIn("Earlier questions were dropped", prompt)

    def test_labels_each_side_of_the_conversation(self) -> None:
        prompt = build(history=[
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ])
        self.assertIn("Question: first question", prompt)
        self.assertIn("Your answer: first answer", prompt)

    def test_says_so_when_no_follow_ups_have_been_asked(self) -> None:
        self.assertIn("No follow-up questions have been asked yet.", build())

    def test_trims_an_overlong_message(self) -> None:
        prompt = build(history=[{"role": "user", "content": "y" * (MAX_FOLLOWUP_MESSAGE_CHARS + 500)}])
        self.assertIn("trimmed for length", prompt)


class SummaryTests(unittest.TestCase):
    def test_includes_the_brief(self) -> None:
        self.assertIn("The brief.", build(summary="The brief."))

    def test_trims_an_overlong_brief(self) -> None:
        prompt = build(summary="z" * (MAX_FOLLOWUP_SUMMARY_CHARS + 500))
        self.assertIn("trimmed for length", prompt)

    def test_survives_an_empty_brief(self) -> None:
        self.assertIn("Unavailable.", build(summary=""))


class QuestionTests(unittest.TestCase):
    def test_asks_the_new_question_last(self) -> None:
        prompt = build(question="What about pricing?")
        self.assertIn("New question: What about pricing?", prompt)
        self.assertLess(prompt.index("END CONVERSATION SO FAR"), prompt.index("New question:"))


if __name__ == "__main__":
    unittest.main()
