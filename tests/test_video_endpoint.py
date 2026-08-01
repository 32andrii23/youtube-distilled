import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException

from backend import main
from backend.youtube import VideoContext

VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
VIDEO_ID = "dQw4w9WgXcQ"


class VideoNameEndpointTests(unittest.TestCase):
    """The web app names the browser tab from this, so it must answer without a
    transcript fetch and without disturbing the context the follow-ups rely on."""

    def setUp(self) -> None:
        main.context_cache.clear()
        self.addCleanup(main.context_cache.clear)

    def ask(self, url: str = VIDEO_URL, name=("A video", "A channel")):
        with mock.patch.object(main, "fetch_name", return_value=name) as fetch:
            response = asyncio.run(main.video(url))
        return response, fetch

    def test_returns_the_videos_own_name(self) -> None:
        response, _ = self.ask()

        self.assertEqual(response.title, "A video")
        self.assertEqual(response.author, "A channel")
        self.assertEqual(response.video_url, VIDEO_URL)

    def test_normalizes_the_url_it_was_given(self) -> None:
        response, _ = self.ask("https://youtu.be/dQw4w9WgXcQ")

        self.assertEqual(response.video_url, VIDEO_URL)

    def test_rejects_anything_that_is_not_a_youtube_video(self) -> None:
        with self.assertRaises(HTTPException) as caught:
            self.ask("https://example.com/watch?v=dQw4w9WgXcQ")

        self.assertEqual(caught.exception.status_code, 422)

    def test_answers_a_known_video_from_the_cache_without_fetching(self) -> None:
        main.remember_context(
            VIDEO_ID,
            VideoContext(title="Cached video", author="Cached channel", duration_seconds=600),
        )

        response, fetch = self.ask()

        fetch.assert_not_called()
        self.assertEqual(response.title, "Cached video")

    # A name-only context in the cache would tell /api/followup that the video has
    # no transcript, which is worse than fetching the name twice.
    def test_does_not_cache_the_name_it_fetched(self) -> None:
        self.ask()

        self.assertIsNone(main.recall_context(VIDEO_ID))

    def test_survives_a_video_youtube_will_not_name(self) -> None:
        response, _ = self.ask(name=(None, None))

        self.assertIsNone(response.title)
        self.assertEqual(response.video_url, VIDEO_URL)
