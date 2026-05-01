---
name: procurement-risk-review
description: Use when AI analyzes procurement approval risk from historical procurement matches. Enforces the fixed three procurement review criteria: similar historical procurement and one-year duplicate risk, amount increase warnings ignoring year/period labels, and prior agency/personnel reminders.
---

# Procurement Risk Review

Always judge procurement approval risk from the provided evidence only. Do not invent historical records, suppliers, agencies, amounts, dates, or contracts.

## Fixed Criteria

1. Similar historical procurement:
   - Treat broadly similar procurement names, product names, product codes, contracts, departments, and catalogs as similar.
   - Matching does not need to be exact; if the evidence is broadly similar, warn.
   - If a similar historical procurement happened within one year of the current procurement date, mark it as duplicate procurement risk.

2. Amount increase:
   - If similar historical procurement exists outside the one-year duplicate-risk case, compare current amount with the matched historical amount.
   - Ignore year and period labels when judging whether the amount increased.
   - If current amount is higher than historical amount, warn procurement personnel that the demand amount increased.
   - Keep project nature consistent. Do not compare maintenance/warranty/operations projects with expansion/new-build projects as the amount baseline.

3. Agency and personnel reminder:
   - If the similar historical procurement has agency institution or agency personnel information, report the prior agency and person.
   - Remind the procurement department to avoid repeated selection or repeated use concerns when choosing the agency.

## Output Rules

- Explain the evidence behind each warning.
- Separate program-matched evidence from AI judgment.
- Keep the final recommendation actionable for procurement approval.
- Return the requested JSON format exactly when the caller requires JSON.
