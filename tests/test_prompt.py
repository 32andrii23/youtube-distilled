import unittest

from backend.prompt import SUMMARY_PROMPT, VIEWER_PROFILE, build_prompt

# The nine types the analysis may draw. tests/diagrams.test.ts holds the other
# half of this contract: every type named here has to have a sizing entry in the
# panel and a header the repair module recognises.
DIAGRAM_TYPES = (
    "flowchart",
    "mindmap",
    "stateDiagram-v2",
    "sequenceDiagram",
    "quadrantChart",
    "erDiagram",
    "timeline",
    "sankey-beta",
    "xychart-beta",
)

# Types mermaid draws that the analysis is not allowed to reach for. Naming one
# in passing would be enough for a model to try it, and nothing downstream sizes
# or repairs it.
UNSUPPORTED_TYPES = (
    "classDiagram",
    "erdiagram",
    "gantt",
    "gitGraph",
    "journey",
    "pie",
    "requirementDiagram",
    "block-beta",
    "packet-beta",
    "kanban",
    "architecture-beta",
    "treemap-beta",
    "radar-beta",
    "C4Context",
)


class SummaryPromptDiagramTests(unittest.TestCase):
    def test_asks_for_a_diagrams_section(self) -> None:
        self.assertIn("## 9. Diagrams", SUMMARY_PROMPT)

    def test_names_every_permitted_diagram_type(self) -> None:
        for diagram_type in DIAGRAM_TYPES:
            with self.subTest(diagram_type=diagram_type):
                self.assertIn(f"`{diagram_type}`", SUMMARY_PROMPT)

    def test_names_no_diagram_type_the_app_cannot_draw(self) -> None:
        # Backticked, the way the section names a type it is offering. Bare
        # would catch `pie` inside "opinion piece".
        for diagram_type in UNSUPPORTED_TYPES:
            with self.subTest(diagram_type=diagram_type):
                self.assertNotIn(f"`{diagram_type}`", SUMMARY_PROMPT)

    def test_caps_the_diagram_count_and_allows_none(self) -> None:
        self.assertIn("at most four diagrams", SUMMARY_PROMPT)
        self.assertIn("Zero is a correct and common answer", SUMMARY_PROMPT)

    def test_routes_the_diagram_choice_by_what_the_video_is(self) -> None:
        # The section used to offer a flat list of types, which the model
        # answered with the same chronological flowchart whatever it had
        # watched. The table makes the video's own shape the thing that picks.
        self.assertIn("| If the video is | Draw | With |", SUMMARY_PROMPT)
        self.assertIn("an argument, essay, or opinion piece", SUMMARY_PROMPT)
        self.assertIn("prefer two diagrams of different types", SUMMARY_PROMPT)

    def test_refuses_a_diagram_that_redraws_the_running_order(self) -> None:
        # The complaint this section was rewritten for: a chain of timecodes,
        # which is section 3 again with boxes around it.
        self.assertIn("the video's own sections in order", SUMMARY_PROMPT)
        self.assertIn("That is section 3 as a picture", SUMMARY_PROMPT)
        self.assertIn("a node whose label is a section title and a timestamp", SUMMARY_PROMPT)

    def test_sets_a_structural_bar_for_drawing_at_all(self) -> None:
        # A picture with no branch, loop, or convergence in it is a list, and
        # prose does lists better.
        self.assertIn("no branch, no loop, and no two arrows arriving", SUMMARY_PROMPT)
        self.assertIn("is a list", SUMMARY_PROMPT)

    def test_makes_timecodes_anchors_rather_than_node_content(self) -> None:
        # Requiring one on every node is what produced the chain of timecodes.
        self.assertIn("Timecodes are anchors to the evidence", SUMMARY_PROMPT)
        self.assertIn("put the timecode at the end of the label", SUMMARY_PROMPT)
        self.assertIn("Never open a label with a timecode", SUMMARY_PROMPT)
        self.assertIn("never put one on every node", SUMMARY_PROMPT)

    def test_keeps_the_timeline_for_the_subject_not_the_playhead(self) -> None:
        self.assertIn("a `timeline` of the video's runtime", SUMMARY_PROMPT)
        self.assertIn("chronology inside the subject", SUMMARY_PROMPT)

    def test_spells_out_the_syntax_that_draws_the_wrong_picture(self) -> None:
        # Each of these parses cleanly and then renders something the video
        # never said. extension/mermaid-repair.js catches them too, but the
        # prompt is the cheaper place to stop them.
        self.assertIn('state "Novice investor" as Novice_investor', SUMMARY_PROMPT)
        self.assertIn('FOUNDER ||--o{ COMPANY : "starts and funds"', SUMMARY_PROMPT)
        self.assertIn("quote the title and the y-axis label", SUMMARY_PROMPT)

    def test_forbids_the_click_directive(self) -> None:
        self.assertIn("Never use Mermaid's `click` directive", SUMMARY_PROMPT)

    def test_puts_the_new_section_after_the_final_compression(self) -> None:
        self.assertLess(
            SUMMARY_PROMPT.index("## 8. Final Compression"),
            SUMMARY_PROMPT.index("## 9. Diagrams"),
        )

    def test_requires_disjoint_watch_guide_periods(self) -> None:
        # Overlapping periods draw brackets on top of each other on the seek
        # bar, so the guide has to hand back an ordered, disjoint set.
        self.assertIn("Never overlap or nest two periods", SUMMARY_PROMPT)
        self.assertIn("ascending order", SUMMARY_PROMPT)

    def test_treats_the_ten_minute_guide_as_a_ceiling(self) -> None:
        # A video whose value fits in two minutes should come back with two, so
        # the budget has to read as a maximum rather than a quota to fill.
        self.assertIn("Ten minutes is a ceiling, not a target", SUMMARY_PROMPT)
        self.assertIn("at most 10 minutes total", SUMMARY_PROMPT)
        self.assertIn("total watch time of the rows you picked", SUMMARY_PROMPT)

    def test_spells_out_the_timeline_colon_rule(self) -> None:
        # A timecode left of the colon is the timeline period, and mermaid
        # cannot parse it there — quoted or not. Verified against mermaid 11.
        self.assertIn("`1996 : Company founded`", SUMMARY_PROMPT)
        self.assertIn("A timecode can only ever appear on the right", SUMMARY_PROMPT)
        self.assertIn("write `Opening claim : 01:12`, never `01:12 : Opening claim`", SUMMARY_PROMPT)


class SummaryPromptVerdictTests(unittest.TestCase):
    def test_opens_the_brief_with_the_verdict(self) -> None:
        # The score is the one thing read before deciding whether to read
        # anything else, so it cannot sit below the summary.
        self.assertIn("## 0. Verdict", SUMMARY_PROMPT)
        self.assertLess(
            SUMMARY_PROMPT.index("## 0. Verdict"),
            SUMMARY_PROMPT.index("## 1. Video Summary"),
        )

    def test_pins_the_two_lines_the_parser_reads(self) -> None:
        # extension/verdict.js reads exactly these two labels. Renaming either
        # one here silently drops the badge from both surfaces.
        self.assertIn("Score: NN/100", SUMMARY_PROMPT)
        self.assertIn("Why: One or two sentences", SUMMARY_PROMPT)

    def test_bands_match_the_ones_the_badge_colours(self) -> None:
        # The thresholds in extension/verdict.js are 70 and 40. A prompt that
        # scores against different bands would colour the badge against the
        # meaning the model intended.
        self.assertIn("| 70-100 |", SUMMARY_PROMPT)
        self.assertIn("| 40-69 |", SUMMARY_PROMPT)
        self.assertIn("| 0-39 |", SUMMARY_PROMPT)

    def test_scores_relevance_rather_than_quality(self) -> None:
        # A well-made video about something already known is worth nothing, and
        # that is the judgement the whole feature exists to make.
        self.assertIn("Score the video's worth to me, not its quality in general", SUMMARY_PROMPT)
        self.assertIn("Familiarity cuts the score hard", SUMMARY_PROMPT)

    def test_forbids_hedging_and_timecodes(self) -> None:
        self.assertIn("Do not hedge to the middle", SUMMARY_PROMPT)
        self.assertIn("No timecodes in this section", SUMMARY_PROMPT)


class ViewerProfileTests(unittest.TestCase):
    def test_ships_the_profile_with_every_brief(self) -> None:
        prompt = build_prompt("https://youtu.be/abc123")
        self.assertIn(VIEWER_PROFILE, prompt)

    def test_puts_the_profile_where_the_verdict_says_to_look(self) -> None:
        # Section 0 tells the model the profile is further down. If it ever
        # moves above the instructions that sentence starts pointing at nothing.
        prompt = build_prompt("https://youtu.be/abc123")
        self.assertLess(prompt.index("## 0. Verdict"), prompt.index("BEGIN VIEWER PROFILE"))

    def test_carries_both_levers_the_score_turns_on(self) -> None:
        # A score needs the floor as much as the ceiling: without the list of
        # what is already known, a polished beginner tutorial scores well.
        self.assertIn("What I already have cold", VIEWER_PROFILE)
        self.assertIn("What I am actually trying to learn", VIEWER_PROFILE)
        self.assertIn("What I do not want", VIEWER_PROFILE)


if __name__ == "__main__":
    unittest.main()
