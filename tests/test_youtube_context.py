import unittest

from backend.prompt import build_prompt
from backend.youtube import VideoContext, format_timestamp, parse_watch_metadata


class YouTubeContextTests(unittest.TestCase):
    def test_formats_video_timestamps(self) -> None:
        self.assertEqual(format_timestamp(0), "00:00")
        self.assertEqual(format_timestamp(754), "12:34")
        self.assertEqual(format_timestamp(3723), "01:02:03")

    def test_parses_description_and_duration(self) -> None:
        page = r'{"shortDescription":"Intro\n00:51 Topic","lengthSeconds":"1563"}'
        description, duration = parse_watch_metadata(page)
        self.assertEqual(description, "Intro\n00:51 Topic")
        self.assertEqual(duration, 1563)

    def test_prompt_uses_extracted_transcript_as_primary_evidence(self) -> None:
        context = VideoContext(
            title="A useful video",
            author="Creator",
            duration_seconds=90,
            description="00:00 Intro",
            transcript="[00:00] Hello\n[00:30] Main idea",
            transcript_language="English",
            transcript_generated=True,
        )

        prompt = build_prompt("https://www.youtube.com/watch?v=dQw4w9WgXcQ", context)

        self.assertIn("Treat it as the primary evidence", prompt)
        self.assertIn("Transcript (English, auto-generated)", prompt)
        self.assertIn("[00:30] Main idea", prompt)


if __name__ == "__main__":
    unittest.main()
