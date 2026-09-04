// The panel loads verdict.js directly and the web app imports the same file
// through vite, the way mermaid-repair.js is shared. Both surfaces open a brief
// with the same badge, so the bands belong in one place.
export interface Verdict {
  score: number
  reason: string
  floor: number
  tone: "watch" | "skim" | "skip"
  label: string
  note: string
}

export declare function extractVerdict(markdown: string): Verdict | null
export declare function verdictBand(score: number): Omit<Verdict, "score" | "reason">
export declare function isVerdictHeading(title: string): boolean
