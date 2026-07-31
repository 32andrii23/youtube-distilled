import unittest

from backend.main import (
    CONTEXT_CACHE_LIMIT,
    context_cache,
    recall_context,
    remember_context,
    video_id_from_url,
)
from backend.youtube import VideoContext


def context_for(title: str) -> VideoContext:
    return VideoContext(title=title, author="A channel", description="", duration_seconds=600)


class VideoIdTests(unittest.TestCase):
    def test_reads_the_id_from_a_normalized_url(self) -> None:
        self.assertEqual(
            video_id_from_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            "dQw4w9WgXcQ",
        )


class ContextCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        context_cache.clear()
        self.addCleanup(context_cache.clear)

    def test_recalls_what_it_remembered(self) -> None:
        remember_context("aaa", context_for("First"))
        recalled = recall_context("aaa")
        self.assertIsNotNone(recalled)
        self.assertEqual(recalled.title, "First")

    def test_returns_none_for_a_video_it_never_saw(self) -> None:
        self.assertIsNone(recall_context("missing"))

    def test_evicts_the_least_recently_used_entry(self) -> None:
        for index in range(CONTEXT_CACHE_LIMIT):
            remember_context(f"video-{index}", context_for(f"Video {index}"))

        remember_context("newest", context_for("Newest"))

        self.assertIsNone(recall_context("video-0"))
        self.assertIsNotNone(recall_context("newest"))
        self.assertEqual(len(context_cache), CONTEXT_CACHE_LIMIT)

    def test_a_recall_protects_an_entry_from_the_next_eviction(self) -> None:
        for index in range(CONTEXT_CACHE_LIMIT):
            remember_context(f"video-{index}", context_for(f"Video {index}"))

        # Touching the oldest entry should make video-1 the next one out.
        recall_context("video-0")
        remember_context("newest", context_for("Newest"))

        self.assertIsNotNone(recall_context("video-0"))
        self.assertIsNone(recall_context("video-1"))

    def test_remembering_the_same_video_twice_does_not_grow_the_cache(self) -> None:
        remember_context("aaa", context_for("First"))
        remember_context("aaa", context_for("Second"))

        self.assertEqual(len(context_cache), 1)
        self.assertEqual(recall_context("aaa").title, "Second")


if __name__ == "__main__":
    unittest.main()
