import unittest

from backend.main import normalize_youtube_url


class NormalizeYouTubeUrlTests(unittest.TestCase):
    def test_normalizes_standard_url(self) -> None:
        self.assertEqual(
            normalize_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )

    def test_normalizes_short_url(self) -> None:
        self.assertEqual(
            normalize_youtube_url("https://youtu.be/dQw4w9WgXcQ"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )

    def test_normalizes_shorts_url(self) -> None:
        self.assertEqual(
            normalize_youtube_url("https://youtube.com/shorts/dQw4w9WgXcQ"),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        )

    def test_rejects_non_youtube_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid YouTube"):
            normalize_youtube_url("https://example.com/watch?v=dQw4w9WgXcQ")

    def test_rejects_missing_video_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "video ID"):
            normalize_youtube_url("https://youtube.com/watch")


if __name__ == "__main__":
    unittest.main()
