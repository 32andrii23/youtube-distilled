import json
import unittest
from unittest import mock

from backend import youtube
from backend.prompt import build_prompt
from backend.youtube import VideoContext, fetch_name, format_timestamp, parse_watch_metadata


class YouTubeContextTests(unittest.TestCase):
    def test_formats_video_timestamps(self) -> None:
        self.assertEqual(format_timestamp(0), "00:00")
        self.assertEqual(format_timestamp(754), "12:34")
        self.assertEqual(format_timestamp(3723), "01:02:03")

    def test_reads_the_name_from_oembed(self) -> None:
        oembed = json.dumps({"title": "  A video  ", "author_name": "A channel"})
        with mock.patch.object(youtube, "_fetch_text", return_value=oembed):
            self.assertEqual(fetch_name("dQw4w9WgXcQ"), ("A video", "A channel"))

    def test_asks_only_oembed_for_a_name(self) -> None:
        oembed = json.dumps({"title": "A video", "author_name": "A channel"})
        with mock.patch.object(youtube, "_fetch_text", return_value=oembed) as fetch:
            fetch_name("dQw4w9WgXcQ")

        # One request, and not the watch page: the tab should not wait on a
        # description it will never show.
        fetch.assert_called_once()
        self.assertIn("oembed", fetch.call_args.args[0])

    def test_reports_no_name_when_youtube_will_not_give_one(self) -> None:
        for answer in ('{"title": ""}', "not json", OSError("offline")):
            with self.subTest(answer=answer):
                side_effect = answer if isinstance(answer, Exception) else None
                with mock.patch.object(
                    youtube,
                    "_fetch_text",
                    side_effect=side_effect,
                    return_value=None if side_effect else answer,
                ):
                    self.assertEqual(fetch_name("dQw4w9WgXcQ")[0], None)

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
