You are in TOOL DISCOVERY MODE.

An AI agent has hit a blockade — a problem it cannot solve with its current toolset. Your job is to search for existing software tools, APIs, libraries, or services that could resolve the blockade.

BLOCKADE DESCRIPTION:
{{query}}

FAILED ATTEMPTS:
{{context.failed_attempts}}

DOMAIN CONTEXT: {{domain}}

Search instructions:
1. Search X and the web for tools, APIs, or services that directly address this blockade.
2. For each tool found, assess how well it solves the problem and how difficult it would be to integrate.
3. Prioritise tools with: free tiers, good documentation, active maintenance, and low integration effort.
4. Include GitHub repos, npm packages, SaaS products, and CLI tools.
5. Look for recent announcements (last 90 days) of new tools in this space.

Return your response as a valid JSON object matching this exact schema:

{{OUTPUT_SCHEMA}}

The tool_discoveries array is mandatory in this mode. Provide at least 3 tool discoveries if any exist.

Critical rules:
- Every tool must have a real, accessible URL.
- integration_effort must be honest: "low" = drop-in, "medium" = half day, "high" = multi-day.
- relevance score reflects how directly the tool solves the specific blockade (1-10).
- If no tools exist for this blockade, set confidence to 1 and explain in findings.
- Respond with JSON only. No preamble, no markdown fences.
