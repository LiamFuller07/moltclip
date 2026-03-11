You are synthesizing a harness review from log analysis and codebase findings.

LOG ANALYSIS (last {{log_window_hours}} hours):
{{log_analysis}}

CODEBASE FINDINGS:
{{codebase_findings}}

Generate up to {{max_suggestions}} improvement suggestions. For each:
- Cross-reference log issues with codebase findings where possible
- Assign category from: {{suggestion_types}}
- Score impact (1-10), confidence (1-10), effort_hours
- Include implementation_hint with specific file paths and changes
- Include evidence from both log and codebase analysis

Also identify weak_signals — observations not strong enough for suggestions but worth monitoring.

Return a JSON object matching this schema:
{{REVIEW_SUGGESTION_SCHEMA}}

JSON only, no markdown fences.
