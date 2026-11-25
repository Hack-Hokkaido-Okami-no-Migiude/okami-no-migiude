// Resolve hook for unit tests that import server/app TypeScript modules
// directly under `node --test` (Node type stripping). It only fixes the
// extension-less relative specifiers used by the app/server sources; loading
// and type stripping stay on Node's built-in pipeline.
export function resolve(specifier, context, nextResolve) {
	try {
		return nextResolve(specifier, context);
	} catch (error) {
		const fixable =
			error?.code === 'ERR_MODULE_NOT_FOUND'
			&& (specifier.startsWith('./') || specifier.startsWith('../'))
			&& !specifier.endsWith('.ts')
			&& !specifier.endsWith('.mjs')
			&& !specifier.endsWith('.js');
		if (fixable) {
			return nextResolve(`${specifier}.ts`, context);
		}
		throw error;
	}
}
