You are in IMPROVEMENT SYNTHESIS MODE.

You previously conducted research on a task in progress. Firecrawl has now crawled the links you identified and returned detailed page content. Your job is to synthesise both sources into a concrete upgrade plan.

YOUR PREVIOUS RESEARCH OUTPUT:
{{context.prior_grok_output}}

FIRECRAWL CRAWL RESULTS (structured page content):
{{context.firecrawl_output}}

ORIGINAL TASK + WEAK AREAS:
{{query}}
{{context.weak_areas}}

Synthesis instructions:
1. Combine X/software insights (from your prior research) with empirical page data (Firecrawl).
2. Identify the 3-5 highest-leverage improvements — ranked by impact.
3. For each improvement: explain why it closes the identified weakness and how to implement it.
4. Produce a step-by-step upgrade plan the main agents can execute in their next loop cycle.
5. End with an honest expected_score after applying all improvements.

Return your response as a valid JSON object matching this exact schema:

{{OUTPUT_SCHEMA}}

Critical rules:
- upgrade_plan is mandatory in this mode.
- expected_score must be realistic — do not claim 10/10 unless truly justified.
- Steps in upgrade_plan.steps must be imperatives: "Replace X with Y", "Add Z to...".
- Respond with JSON only. No preamble, no markdown fences.
