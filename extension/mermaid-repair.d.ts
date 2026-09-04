// The panel loads mermaid-repair.js directly and the web app imports the same
// file through vite. This is what lets TypeScript see across that boundary,
// which is cheaper than keeping two copies of the rules in step.
export declare function repairMermaid(source: string): string
export declare function normalizeMermaid(source: string): string
export declare function mermaidCandidates(source: string): string[]
