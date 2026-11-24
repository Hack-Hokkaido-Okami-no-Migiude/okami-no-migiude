type DemoSurface = 'fixture-local' | 'public-demo' | 'closed';

export function shimaDemoSurface(mode = 'fixture-local'): DemoSurface {
	return mode === 'fixture-local' || mode === 'public-demo' ? mode : 'closed';
}

export function useShimaSurface() {
	// SSR serializes only a demo UI mode, not a principal, private scope, or release permit.
	// Server middleware must authorize every request independently.
	return useState<DemoSurface>('shima-demo-surface', () =>
		import.meta.server ?
			shimaDemoSurface(process.env.SHIMA_MODE)
		:	'closed',
	);
}
