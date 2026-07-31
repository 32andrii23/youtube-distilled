import unittest

from backend.prompt import SUMMARY_PROMPT

TIMECODED_TYPES = ("timeline", "flowchart", "sequenceDiagram")
EXPLANATORY_TYPES = ("mindmap", "quadrantChart", "sankey-beta")


class SummaryPromptDiagramTests(unittest.TestCase):
    def test_asks_for_a_diagrams_section(self) -> None:
        self.assertIn("## 9. Diagrams", SUMMARY_PROMPT)

    def test_names_every_permitted_diagram_type(self) -> None:
        for diagram_type in TIMECODED_TYPES + EXPLANATORY_TYPES:
            with self.subTest(diagram_type=diagram_type):
                self.assertIn(diagram_type, SUMMARY_PROMPT)

    def test_caps_the_diagram_count_and_allows_none(self) -> None:
        self.assertIn("up to five", SUMMARY_PROMPT)
        self.assertIn("Zero diagrams is a correct", SUMMARY_PROMPT)

    def test_forbids_the_click_directive(self) -> None:
        self.assertIn("Never use Mermaid's `click` directive", SUMMARY_PROMPT)

    def test_puts_the_new_section_after_the_final_compression(self) -> None:
        self.assertLess(
            SUMMARY_PROMPT.index("## 8. Final Compression"),
            SUMMARY_PROMPT.index("## 9. Diagrams"),
        )

    def test_spells_out_the_timeline_colon_rule(self) -> None:
        # A timecode left of the colon is the timeline period, and mermaid
        # cannot parse it there — quoted or not. Verified against mermaid 11.
        self.assertIn("Opening claim : 01:12", SUMMARY_PROMPT)
        self.assertIn("never to the left of it", SUMMARY_PROMPT)


if __name__ == "__main__":
    unittest.main()
