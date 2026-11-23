// Provider seam: what analysis needs from a fixture or live LLM provider.
// Providers receive bounded stage inputs (see shared/p0/stages.ts) and return
// raw stage outputs; parsing/validation/reconciliation happens in the analysis
// pipeline for both modes. Providers never touch the repository or Nitro.
import type { RunMode } from '../../shared/p0/api';

export type AnalysisProvider = {
	mode: RunMode;
	/** Non-secret identity included in artifact keys (never the API key). */
	key: string;
	run(
		operation: 'extract' | 'assess' | 'propose',
		input: unknown,
	): Promise<unknown>;
};
