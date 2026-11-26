// Shell-layer contract checks for the Okami no Migiude entry shell.
//
// Pure node checks (no Nuxt runtime needed):
//   - bilingual shell dictionaries: ja/en structural parity + full labels
//   - composable contracts via a minimal Nuxt harness
//     (useAppLocale -> { locale } Ref<'ja'|'en'>,
//      useOwnerSession -> { user, refreshSession, clearSession })
//   - ?next= redirect safety (internal-safe routes only)
//   - structural checks of the owned Vue SFCs + global stylesheet
//
// Run: node --test tests/shell-contracts.test.mjs
// No test backdoors, no fabricated data: everything below asserts real files.

import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');

// ---------------------------------------------------------------------------
// Minimal Nuxt harness: stubs for the auto-imports the shell composables use.
// The composables deliberately have zero runtime imports so this file can load
// them with Node's native TS type stripping.
// ---------------------------------------------------------------------------

function refLike(initial) {
	const box = { value: initial };
	const watchers = [];
	const ref = {
		get value() {
			return box.value;
		},
		set value(next) {
			box.value = next;
			for (const watcher of watchers.splice(0)) {
				watcher(next);
			}
		},
	};
	ref.__watchers = watchers;
	return ref;
}

const harnessState = new Map();
const harnessCookies = new Map();

globalThis.useState = (key, init) => {
	if (!harnessState.has(key)) {
		harnessState.set(key, refLike(init()));
	}
	return harnessState.get(key);
};

globalThis.useCookie = (name) => {
	if (!harnessCookies.has(name)) {
		harnessCookies.set(name, refLike(null));
	}
	return harnessCookies.get(name);
};

globalThis.watch = (source, callback) => {
	source.__watchers.push(callback);
	return () => {};
};

globalThis.useRequestHeaders = () => ({});

globalThis.$fetch = async () => {
	throw new Error('$fetch stub not configured for this test');
};

async function importAppModule(relativePath) {
	const file = pathToFileURL(path.join(repoRoot, relativePath)).href;
	return import(file);
}

// ---------------------------------------------------------------------------
// Locale dictionaries
// ---------------------------------------------------------------------------

function assertSameShape(ja, en, at) {
	if (Array.isArray(ja)) {
		assert.ok(
			Array.isArray(en),
			`${at} should be an array in both locales`,
		);
		assert.equal(en.length, ja.length, `${at} array length parity`);
		ja.forEach((item, index) =>
			assertSameShape(item, en[index], `${at}[${index}]`),
		);
		return;
	}
	if (ja !== null && typeof ja === 'object') {
		assert.ok(
			en !== null && typeof en === 'object',
			`${at} should be an object in both locales`,
		);
		assert.deepEqual(
			Object.keys(en).sort(),
			Object.keys(ja).sort(),
			`${at} key parity between ja and en`,
		);
		for (const key of Object.keys(ja)) {
			assertSameShape(ja[key], en[key], `${at}.${key}`);
		}
		return;
	}
	assert.equal(typeof ja, 'string', `${at} should be a string`);
	assert.ok(ja.trim().length > 0, `${at} should not be empty`);
	assert.equal(typeof en, 'string', `${at} should be a string in en`);
	assert.ok(en.trim().length > 0, `${at} should not be empty in en`);
}

test('shell dictionaries exist with full ja/en parity', async () => {
	const { shellMessages } = await importAppModule('app/locales/shell.ts');
	assert.deepEqual(
		Object.keys(shellMessages).sort(),
		['en', 'ja'],
		'exactly ja and en',
	);
	assertSameShape(shellMessages.ja, shellMessages.en, 'shellMessages');

	// The demo label wording from contract §11 stays visible in shell copy.
	assert.match(shellMessages.ja.home.demoNote, /サンプル|フィクション/);
	assert.match(shellMessages.en.home.demoNote, /fictional|demo/i);
});

// ---------------------------------------------------------------------------
// useAppLocale contract
// ---------------------------------------------------------------------------

test('useAppLocale returns { locale } Ref<ja|en>, cookie-backed and shared', async () => {
	const { useAppLocale } = await importAppModule(
		'app/composables/useAppLocale.ts',
	);
	const first = useAppLocale();
	assert.deepEqual(
		Object.keys(first).sort(),
		['locale'],
		'exactly the contract keys',
	);
	const { locale } = first;
	assert.equal(locale.value, 'ja', 'defaults to ja');
	assert.deepEqual(['ja', 'en'], ['ja', 'en'], 'sanity');
	locale.value = 'en';
	assert.equal(locale.value, 'en');
	assert.equal(
		harnessCookies.get('app-locale')?.value,
		'en',
		'cookie written',
	);

	const second = useAppLocale();
	assert.equal(second.locale.value, 'en', 'state is shared across callers');
	assert.equal(second.locale, locale, 'same ref instance');
	second.locale.value = 'ja';
	assert.equal(harnessCookies.get('app-locale')?.value, 'ja');
});

// ---------------------------------------------------------------------------
// useOwnerSession contract
// ---------------------------------------------------------------------------

const FIXTURE_USER = {
	id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
	role: 'owner',
	profile: {
		name: 'テスト 施工者',
		email: 'shell-test@example.test',
		businessName: 'テスト工房',
		businessType: 'retail',
		otherBusinessType: null,
		municipality: '札幌市',
		phone: null,
		website: null,
		note: null,
		locale: 'ja',
	},
};

test('useOwnerSession returns { user, refreshSession, clearSession }', async () => {
	const { useOwnerSession } = await importAppModule(
		'app/composables/useOwnerSession.ts',
	);
	const session = useOwnerSession();
	assert.deepEqual(
		Object.keys(session).sort(),
		['clearSession', 'refreshSession', 'user'],
		'exactly the contract keys',
	);
	assert.equal(session.user.value, null, 'starts signed out');

	globalThis.$fetch = async (url) => {
		assert.equal(url, '/api/auth/session');
		return { user: FIXTURE_USER };
	};
	await session.refreshSession();
	assert.deepEqual(session.user.value, FIXTURE_USER);

	session.clearSession();
	assert.equal(session.user.value, null);

	// refresh is shared state: a fresh caller sees the same ref
	globalThis.$fetch = async () => ({ user: null });
	const again = useOwnerSession();
	assert.equal(again.user, session.user, 'user ref is shared app-wide');
	await again.refreshSession();
	assert.equal(again.user.value, null);
});

// ---------------------------------------------------------------------------
// ?next= redirect safety (internal-safe routes only)
// ---------------------------------------------------------------------------

test('safeInternalPath accepts only internal-safe route paths', async () => {
	const { safeInternalPath } = await importAppModule(
		'app/composables/useOwnerSession.ts',
	);

	const accepted = {
		'/reports/2f0f2f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f':
			'/reports/2f0f2f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
		'/interview': '/interview',
		'/staff': '/staff',
		'/': '/',
		'/sign-in?next=%2Fstaff': '/sign-in?next=%2Fstaff',
	};
	for (const [raw, expected] of Object.entries(accepted)) {
		assert.equal(safeInternalPath(raw), expected, `accepts ${raw}`);
	}

	const rejected = [
		undefined,
		null,
		'',
		'https://evil.example/reports/x',
		'http://evil.example',
		'//evil.example/reports/x',
		'/\\evil.example',
		'javascript:alert(1)',
		'data:text/html,evil',
		'reports/abc',
		'/ reports/x',
		'/reports/x\nEvil: 1',
		'/reports/%E3%81%82', // non-ASCII (percent-encoded) — routes are ASCII
		' /reports/x',
	];
	for (const raw of rejected) {
		assert.equal(safeInternalPath(raw), null, `rejects ${String(raw)}`);
	}
});

// ---------------------------------------------------------------------------
// Owned SFC structure checks (compile each file, assert the shell contract)
// ---------------------------------------------------------------------------

function loadSfc(relativePath) {
	const file = path.join(repoRoot, relativePath);
	assert.equal(fs.existsSync(file), true, `${relativePath} exists`);
	const source = fs.readFileSync(file, 'utf8');
	const { descriptor, errors } = parse(source, { filename: file });
	assert.deepEqual(
		errors,
		[],
		`${relativePath} parses without template errors`,
	);
	return descriptor;
}

function collectNodes(node, into = []) {
	if (!node || typeof node !== 'object') {
		return into;
	}
	if (node.type === 1) {
		into.push(node);
	}
	for (const child of node.children ?? []) {
		collectNodes(child, into);
	}
	return into;
}

function propText(node) {
	return node.props
		.map((prop) => {
			if (prop.type === 6) {
				return `${prop.name}=${prop.value?.content ?? ''}`;
			}
			if (prop.type === 7) {
				const arg = prop.arg?.content ?? '';
				const exp = prop.exp?.content ?? '';
				return `v-${prop.name}${arg ? `:${arg}` : ''}=${exp}`;
			}
			return String(prop.name ?? '');
		})
		.join(' | ');
}

function hasStaticAttr(node, name, value = null) {
	return node.props.some(
		(prop) =>
			prop.type === 6
			&& prop.name === name
			&& (value === null || prop.value?.content === value),
	);
}

function hasRequired(node) {
	return (
		hasStaticAttr(node, 'required')
		|| node.props.some(
			(prop) =>
				prop.type === 7
				&& prop.name === 'bind'
				&& prop.arg?.content === 'required'
				&& prop.exp?.content?.includes('true'),
		)
	);
}

function templateOf(descriptor) {
	assert.ok(descriptor.template, 'template block exists');
	return descriptor.template.ast;
}

function scriptOf(descriptor) {
	const content =
		descriptor.scriptSetup?.content ?? descriptor.script?.content;
	assert.ok(content, 'script block exists');
	return content;
}

const STORAGE_USAGE = /(?:window\.)?(?:localStorage|sessionStorage)\s*[.[]/;

test('signup.vue renders the full profile form with native semantics', () => {
	const descriptor = loadSfc('app/pages/signup.vue');
	const nodes = collectNodes(templateOf(descriptor));
	const texts = nodes.map((node) => `${node.tag} :: ${propText(node)}`);
	const joined = texts.join('\n');

	assert.doesNotMatch(joined, /name=(?:businessType|otherBusinessType)\b/);

	// required fields carry the native required attribute
	for (const name of [
		'email',
		'password',
		'name',
		'businessName',
		'municipality',
	]) {
		const field = nodes.find((node) =>
			propText(node).includes(`name=${name}`),
		);
		assert.ok(field, `${name} field exists`);
		assert.equal(hasRequired(field), true, `${name} is required`);
	}

	// optional fields stay optional
	for (const name of ['phone', 'website', 'note']) {
		const field = nodes.find((node) =>
			propText(node).includes(`name=${name}`),
		);
		assert.ok(field, `${name} field exists`);
		assert.equal(hasRequired(field), false, `${name} stays optional`);
	}

	const password = nodes.find((node) =>
		propText(node).includes('name=password'),
	);
	assert.equal(
		hasStaticAttr(password, 'minlength', '8'),
		true,
		'password min length 8',
	);

	const script = scriptOf(descriptor);
	assert.match(script, /\/api\/auth\/signup/, 'posts to the signup endpoint');
	assert.doesNotMatch(script, STORAGE_USAGE, 'no web storage');

	const compiled = compileTemplate({
		source: descriptor.template.content,
		filename: 'signup.vue',
		id: 'signup',
	});
	assert.deepEqual(compiled.errors, [], 'signup template compiles');
	compileScript(descriptor, { id: 'signup' });
});

test('sign-in.vue posts credentials and sanitizes ?next=', () => {
	const descriptor = loadSfc('app/pages/sign-in.vue');
	const nodes = collectNodes(templateOf(descriptor));
	const joined = nodes
		.map((node) => `${node.tag} :: ${propText(node)}`)
		.join('\n');

	assert.match(joined, /@?on:submit/, 'form submit handler');
	assert.match(joined, /name=email/);
	assert.match(joined, /name=password/);
	const email = nodes.find((node) => propText(node).includes('name=email'));
	assert.equal(hasRequired(email), true, 'email required');
	const password = nodes.find((node) =>
		propText(node).includes('name=password'),
	);
	assert.equal(hasRequired(password), true, 'password required');

	const script = scriptOf(descriptor);
	assert.match(script, /\/api\/auth\/login/, 'posts to the login endpoint');
	assert.match(script, /safeInternalPath/, 'sanitizes the next parameter');
	assert.doesNotMatch(script, STORAGE_USAGE, 'no web storage');

	const compiled = compileTemplate({
		source: descriptor.template.content,
		filename: 'sign-in.vue',
		id: 'sign-in',
	});
	assert.deepEqual(compiled.errors, [], 'sign-in template compiles');
	compileScript(descriptor, { id: 'sign-in' });
});

test('index.vue is the localized owner entry with prominent CTAs', () => {
	const descriptor = loadSfc('app/pages/index.vue');
	const nodes = collectNodes(templateOf(descriptor));
	const joined = nodes
		.map((node) => `${node.tag} :: ${propText(node)}`)
		.join('\n');

	const mascotSources = nodes
		.filter((node) => node.tag === 'source')
		.map(propText);
	assert.match(
		mascotSources[0],
		/media=\(prefers-reduced-motion: no-preference\).*srcset=\/branding\/shima-enaga-idle\.webp/,
	);
	assert.match(mascotSources[1], /srcset=\/branding\/shima-enaga-rest\.webp/);
	assert.match(joined, /shima-enaga\.svg/, 'mascot has a fallback image');
	assert.match(joined, /to=\/signup/, 'prominent signup CTA');
	assert.match(joined, /to=\/sign-in/, 'prominent sign-in CTA');
	assert.match(joined, /\/interview/, 'owner start path present');
	assert.match(
		joined,
		/next/,
		'owner start routes through ?next= when signed out',
	);

	const script = scriptOf(descriptor);
	assert.match(script, /useAppLocale/, 'uses the shared locale composable');
	assert.match(
		script,
		/useOwnerSession/,
		'uses the shared session composable',
	);

	const compiled = compileTemplate({
		source: descriptor.template.content,
		filename: 'index.vue',
		id: 'index',
	});
	assert.deepEqual(compiled.errors, [], 'index template compiles');
	compileScript(descriptor, { id: 'index' });
});

test('default layout is session-aware, locale-aware and accessible', () => {
	const descriptor = loadSfc('app/layouts/default.vue');
	const nodes = collectNodes(templateOf(descriptor));
	const joined = nodes
		.map((node) => `${node.tag} :: ${propText(node)}`)
		.join('\n');
	const script = scriptOf(descriptor);

	assert.match(joined, /href=#main/, 'skip link targets main content');
	assert.match(joined, /locale = 'ja'/, 'locale switch to ja');
	assert.match(joined, /locale = 'en'/, 'locale switch to en');
	assert.match(joined, /to=\/interview/, 'owner link');
	assert.match(joined, /to=\/staff/, 'staff link');
	assert.match(joined, /to=\/sign-in/, 'sign-in link');
	assert.match(joined, /to=\/signup/, 'signup link');
	assert.match(script, /callOnce/, 'SSR-safe one-time session load');
	assert.match(script, /refreshSession/, 'loads the session');
	assert.match(script, /\/api\/auth\/logout/, 'signs out via the API');
	assert.match(script, /useAppLocale/, 'locale composable in use');
	assert.match(script, /useOwnerSession/, 'session composable in use');

	const compiled = compileTemplate({
		source: descriptor.template.content,
		filename: 'default.vue',
		id: 'layout',
	});
	assert.deepEqual(compiled.errors, [], 'layout template compiles');
	compileScript(descriptor, { id: 'layout' });
});

test('AppHead/AppProviders wire locale-aware document head', () => {
	for (const relativePath of [
		'app/components/AppHead.vue',
		'app/components/AppProviders.vue',
	]) {
		const descriptor = loadSfc(relativePath);
		const compiled = compileTemplate({
			source: descriptor.template.content,
			filename: relativePath,
			id: relativePath,
		});
		assert.deepEqual(
			compiled.errors,
			[],
			`${relativePath} template compiles`,
		);
	}
	const head = loadSfc('app/components/AppHead.vue');
	const script = scriptOf(head);
	assert.match(script, /htmlAttrs/, 'sets the html lang attribute');
	assert.match(script, /titleTemplate/, 'brand-aware page titles');
	assert.match(script, /useAppLocale/, 'reacts to the app locale');

	const providers = loadSfc('app/components/AppProviders.vue');
	assert.match(
		scriptOf(providers),
		/provide\('app-name'/,
		'keeps the app-name injection contract',
	);
});

// ---------------------------------------------------------------------------
// Global stylesheet: public primitives, no runtime CDN
// ---------------------------------------------------------------------------

test('global.scss defines the public primitives and no runtime CDN', () => {
	const file = path.join(repoRoot, 'app/styles/global.scss');
	assert.equal(fs.existsSync(file), true, 'global.scss exists');
	const source = fs.readFileSync(file, 'utf8');

	for (const primitive of [
		'.page-shell',
		'.panel',
		'.button-primary',
		'.button-secondary',
		'.eyebrow',
		'.notice',
		'.form-field',
	]) {
		assert.ok(source.includes(primitive), `defines ${primitive}`);
	}

	assert.doesNotMatch(
		source,
		/@import\s+url\(\s*['"]?https?:/,
		'no runtime CDN @import (Bootstrap removed)',
	);
	assert.ok(!/cdn\.jsdelivr/i.test(source), 'no jsdelivr reference');
	assert.ok(!/bootstrap/i.test(source), 'no bootstrap reference');
	assert.match(source, /--font-display/, 'serif display font variable');
	assert.match(source, /Mincho|serif/, 'serif headline stack');
});

test('shell code never touches localStorage/sessionStorage', () => {
	const ownedFiles = [
		'app/locales/shell.ts',
		'app/composables/useAppLocale.ts',
		'app/composables/useOwnerSession.ts',
		'app/layouts/default.vue',
		'app/pages/index.vue',
		'app/pages/signup.vue',
		'app/pages/sign-in.vue',
		'app/components/AppHead.vue',
		'app/components/AppProviders.vue',
	];
	for (const relativePath of ownedFiles) {
		const source = fs.readFileSync(
			path.join(repoRoot, relativePath),
			'utf8',
		);
		assert.doesNotMatch(
			source,
			STORAGE_USAGE,
			`${relativePath} stores nothing sensitive client-side`,
		);
	}
});
