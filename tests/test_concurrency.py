import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException

from backend import main
from backend.main import AiRunResult, RunSlots, RunSlotsBusy, SummaryRequest
from backend.youtube import VideoContext

FIRST_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
SECOND_URL = "https://www.youtube.com/watch?v=aaaaaaaaaaa"
THIRD_URL = "https://www.youtube.com/watch?v=bbbbbbbbbbb"


class RunSlotsTests(unittest.TestCase):
    def test_hands_out_up_to_the_limit(self) -> None:
        slots = RunSlots(2)

        with slots.claim(), slots.claim():
            self.assertEqual(slots.active, 2)

        self.assertEqual(slots.active, 0)

    def test_refuses_once_every_slot_is_taken(self) -> None:
        slots = RunSlots(1)

        with slots.claim():
            with self.assertRaises(RunSlotsBusy):
                with slots.claim():
                    pass

    def test_a_failed_run_gives_its_slot_back(self) -> None:
        slots = RunSlots(1)

        with self.assertRaises(RuntimeError):
            with slots.claim():
                raise RuntimeError("Codex could not finish the summary.")

        self.assertEqual(slots.active, 0)


class ParallelSummariesTests(unittest.TestCase):
    """The whole point of the cap being above one: two videos distil at once
    instead of the second waiting on the first."""

    def setUp(self) -> None:
        main.context_cache.clear()
        self.addCleanup(main.context_cache.clear)
        self.addCleanup(setattr, main, "run_slots", main.run_slots)

    def summarize_both(self, limit: int) -> tuple[int, list[object]]:
        main.run_slots = RunSlots(limit)
        both_started = asyncio.Event()
        peak = 0

        async def fake_run_provider(provider, video_url, context, model, reasoning, prompt=None):
            nonlocal peak
            peak = max(peak, main.run_slots.active)
            if main.run_slots.active >= 2:
                both_started.set()
            # Neither run may finish before the other has begun, so a serialized
            # backend deadlocks here instead of passing by accident.
            await asyncio.wait_for(both_started.wait(), timeout=2)
            return AiRunResult(summary="A brief.", analysis_seconds=1.0, processing_seconds=0.1)

        async def run_both():
            return await asyncio.gather(
                main.summarize(SummaryRequest(url=FIRST_URL)),
                main.summarize(SummaryRequest(url=SECOND_URL)),
                return_exceptions=True,
            )

        with (
            mock.patch.object(main, "fetch_video_context", return_value=VideoContext(title="A video")),
            mock.patch.object(main, "run_provider", fake_run_provider),
        ):
            results = asyncio.run(run_both())

        return peak, results

    def test_two_videos_distil_at_the_same_time(self) -> None:
        peak, results = self.summarize_both(limit=2)

        self.assertEqual(peak, 2)
        self.assertEqual([result.summary for result in results], ["A brief.", "A brief."])

    def test_the_cap_answers_429_rather_than_queueing(self) -> None:
        main.run_slots = RunSlots(1)
        started = asyncio.Event()
        release = asyncio.Event()

        async def fake_run_provider(provider, video_url, context, model, reasoning, prompt=None):
            started.set()
            await asyncio.wait_for(release.wait(), timeout=2)
            return AiRunResult(summary="A brief.", analysis_seconds=1.0, processing_seconds=0.1)

        async def run_both():
            first = asyncio.create_task(main.summarize(SummaryRequest(url=FIRST_URL)))
            await started.wait()
            try:
                return await main.summarize(SummaryRequest(url=THIRD_URL))
            finally:
                release.set()
                await first

        with (
            mock.patch.object(main, "fetch_video_context", return_value=VideoContext(title="A video")),
            mock.patch.object(main, "run_provider", fake_run_provider),
        ):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(run_both())

        self.assertEqual(caught.exception.status_code, 429)
        self.assertIn("already being distilled", caught.exception.detail)


class MaxRunsSettingTests(unittest.TestCase):
    def test_reads_the_override_from_the_environment(self) -> None:
        with mock.patch.dict("os.environ", {"YOUTUBE_DISTILLED_MAX_RUNS": "8"}):
            self.assertEqual(main.configured_max_runs(), 8)

    def test_falls_back_when_the_override_is_not_a_number(self) -> None:
        with mock.patch.dict("os.environ", {"YOUTUBE_DISTILLED_MAX_RUNS": "lots"}):
            self.assertEqual(main.configured_max_runs(), main.DEFAULT_MAX_RUNS)

    def test_never_drops_below_one_run(self) -> None:
        with mock.patch.dict("os.environ", {"YOUTUBE_DISTILLED_MAX_RUNS": "0"}):
            self.assertEqual(main.configured_max_runs(), 1)


if __name__ == "__main__":
    unittest.main()
