// Linkup deep-research prompt, ported from okami_voice's
// DEEP_RESEARCH_PROMPT.md. Inlined as a string constant so the Nitro bundle
// needs no extra asset loading. The [LOCATION] placeholder is filled per
// session before the request is sent.

export const DEEP_RESEARCH_PROMPT = `Find documented examples of practical AI and automation at businesses comparable to the one described below.

- **Location:** [LOCATION]
- **Industry:** small local business (accommodation, food service, retail, tourism, and similar)

Start with similar businesses in the area and expand to other regions or adjacent industries when the approach could transfer. Look for real-world implementations with enough detail to explain how the work is done.

For each application, include the following.

- Business problem being addressed.
- AI or automation solution implemented. In the solution field, describe the real workflow in a few concrete steps, including who uses the system, what the tool does, and where information goes when documented.
- Demonstrated results, including time savings, cost reductions or revenue improvements where available.
- Applicability to the target business, including how a smaller operation might adapt the idea. Label proposed adaptations as possibilities.
- Estimated implementation cost and complexity, including any documented software, hardware, integrations, or setup help the example relied on.
- Source URLs.

Prioritise affordable, practical solutions suitable for small and medium-sized businesses. Rank findings by potential business impact and ease of implementation.

Search in English and the local language. Clearly distinguish verified results from estimates and recommendations. Avoid unsupported claims.`;
