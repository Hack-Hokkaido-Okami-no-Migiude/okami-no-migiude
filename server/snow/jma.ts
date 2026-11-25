// Japan Meteorological Agency (JMA) open data for the snow-day flow.
//
// - area.json maps every municipality ("class20" area, e.g. 札幌市 0110000)
//   to its forecast office (e.g. 016000 石狩・空知・後志地方).
// - warning/data/r8/<office>.json lists the warnings and advisories now in
//   force. "r8" is the format JMA has served since the new disaster weather
//   information started on 28-29 May 2026; the older warning/data/warning/
//   files stopped updating then.
// - Snow-related kinds keep their long-standing codes in r8 (checked against
//   live data in Nov 2026: 13 = 風雪注意報, 12 = 大雪注意報).
//
// Network failures never break the page: the caller gets status
// 'unavailable' and the owner can still use the demo simulation.
// QA knob: JMA_BASE_URL points at a loopback stub (https always allowed,
// plain http only for loopback hosts), mirroring the other provider overrides.

export type SnowKind = {
	code: string;
	nameJa: string;
	nameEn: string;
	level: 'advisory' | 'warning' | 'emergency';
};

export const SNOW_KINDS: Record<string, SnowKind> = {
	'12': {
		code: '12',
		nameJa: '大雪注意報',
		nameEn: 'Heavy snow advisory',
		level: 'advisory',
	},
	'13': {
		code: '13',
		nameJa: '風雪注意報',
		nameEn: 'Snowstorm advisory',
		level: 'advisory',
	},
	'06': {
		code: '06',
		nameJa: '大雪警報',
		nameEn: 'Heavy snow warning',
		level: 'warning',
	},
	'02': {
		code: '02',
		nameJa: '暴風雪警報',
		nameEn: 'Blizzard warning',
		level: 'warning',
	},
	'36': {
		code: '36',
		nameJa: '大雪特別警報',
		nameEn: 'Heavy snow emergency warning',
		level: 'emergency',
	},
	'32': {
		code: '32',
		nameJa: '暴風雪特別警報',
		nameEn: 'Blizzard emergency warning',
		level: 'emergency',
	},
};

/** Used by the demo simulation: a heavy snow warning. */
export const SIMULATED_KIND = SNOW_KINDS['06'] as SnowKind;

export type JmaArea = {
	code: string;
	nameJa: string;
	nameEn: string;
	officeCode: string;
	officeNameJa: string;
	officeNameEn: string;
};

export type SnowCheck =
	| { status: 'unknown_area' }
	| { status: 'unavailable'; area: JmaArea | null }
	| {
			status: 'ok';
			area: JmaArea;
			active: SnowKind[];
			reportDatetime: string | null;
	  };

const DEFAULT_BASE_URL = 'https://www.jma.go.jp';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const AREA_TTL_MS = 24 * 60 * 60 * 1000;
const WARNING_TTL_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 8000;

type AreaEntry = {
	name: string;
	enName?: string;
	parent?: string;
	officeName?: string;
};
type AreaJson = {
	offices: Record<string, AreaEntry>;
	class10s: Record<string, AreaEntry>;
	class15s: Record<string, AreaEntry>;
	class20s: Record<string, AreaEntry>;
};
type WarningReport = {
	reportDatetime?: string;
	warning?: {
		class20Items?: {
			areaCode: string;
			kinds?: { code?: string; status?: string }[];
		}[];
	};
};

const cache = new Map<string, { at: number; value: unknown }>();

export function jmaBaseUrl(): string {
	const raw = (process.env.JMA_BASE_URL || '').trim();
	if (raw.length === 0) {
		return DEFAULT_BASE_URL;
	}
	try {
		const url = new URL(raw);
		const loopbackHttp =
			url.protocol === 'http:'
			&& LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
		if (url.protocol === 'https:' || loopbackHttp) {
			return raw.replace(/\/+$/, '');
		}
	} catch {
		// Unsafe or unparseable override: fall back to the real source.
	}
	return DEFAULT_BASE_URL;
}

async function getJson<T>(
	path: string,
	ttlMs: number,
	now: number,
): Promise<T> {
	const url = `${jmaBaseUrl()}${path}`;
	const hit = cache.get(url);
	if (hit && now - hit.at < ttlMs) {
		return hit.value as T;
	}
	const response = await fetch(url, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`JMA HTTP ${response.status}`);
	}
	const value = (await response.json()) as T;
	cache.set(url, { at: now, value });
	return value;
}

function normalize(name: string): string {
	return name
		.normalize('NFKC')
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/^北海道/, '');
}

/** Finds the municipality and its forecast office; Hokkaido first on ties. */
export function resolveArea(
	areas: AreaJson,
	municipality: string,
): JmaArea | null {
	const wanted = normalize(municipality);
	if (wanted.length === 0) {
		return null;
	}
	const matches = Object.entries(areas.class20s).filter(([, entry]) => {
		const ja = normalize(entry.name);
		const en = normalize(entry.enName ?? '');
		return (
			ja === wanted
			|| en === wanted
			|| (wanted.length >= 2 && ja.startsWith(wanted))
		);
	});
	matches.sort(
		([a], [b]) => Number(!a.startsWith('01')) - Number(!b.startsWith('01')),
	);
	for (const [code, entry] of matches) {
		const class15 = entry.parent ? areas.class15s[entry.parent] : undefined;
		const class10 =
			class15?.parent ? areas.class10s[class15.parent] : undefined;
		const officeCode = class10?.parent;
		const office = officeCode ? areas.offices[officeCode] : undefined;
		if (officeCode && office) {
			return {
				code,
				nameJa: entry.name,
				nameEn: entry.enName ?? entry.name,
				officeCode,
				officeNameJa: office.name,
				officeNameEn: office.enName ?? office.name,
			};
		}
	}
	return null;
}

/** Snow kinds currently in force for one municipality. */
export function activeSnowKinds(
	reports: WarningReport[],
	areaCode: string,
): {
	active: SnowKind[];
	reportDatetime: string | null;
} {
	const found = new Map<string, SnowKind>();
	let latest: string | null = null;
	for (const report of Array.isArray(reports) ? reports : []) {
		for (const item of report.warning?.class20Items ?? []) {
			if (item.areaCode !== areaCode) {
				continue;
			}
			for (const kind of item.kinds ?? []) {
				const snow = kind.code ? SNOW_KINDS[kind.code] : undefined;
				if (snow && kind.status && kind.status !== '解除') {
					found.set(snow.code, snow);
				}
			}
			if (
				report.reportDatetime
				&& (!latest || report.reportDatetime > latest)
			) {
				latest = report.reportDatetime;
			}
		}
	}
	const order = { emergency: 0, warning: 1, advisory: 2 };
	return {
		active: [...found.values()].sort(
			(a, b) => order[a.level] - order[b.level],
		),
		reportDatetime: latest,
	};
}

export async function checkSnow(
	municipality: string,
	now: number,
): Promise<SnowCheck> {
	let area: JmaArea | null = null;
	try {
		const areas = await getJson<AreaJson>(
			'/bosai/common/const/area.json',
			AREA_TTL_MS,
			now,
		);
		area = resolveArea(areas, municipality);
		if (!area) {
			return { status: 'unknown_area' };
		}
		const reports = await getJson<WarningReport[]>(
			`/bosai/warning/data/r8/${area.officeCode}.json`,
			WARNING_TTL_MS,
			now,
		);
		return { status: 'ok', area, ...activeSnowKinds(reports, area.code) };
	} catch (error) {
		console.error(
			'[snow] JMA check failed:',
			error instanceof Error ? error.message : error,
		);
		return { status: 'unavailable', area };
	}
}
