// Shared test helper: run a callback with a patched process environment
// (synchronous usage, mirroring the recorded-audio test helper).
export function withEnv(
	values: Record<string, string | undefined>,
	run: () => void,
): void {
	const saved: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(values)) {
		saved[key] = process.env[key];
		if (value === undefined) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
	try {
		run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = value;
			}
		}
	}
}
