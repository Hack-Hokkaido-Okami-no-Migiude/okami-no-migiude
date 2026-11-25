// Signup validates credentials and nonblank owner details. Older clients
// can still send a business classification for downstream reports.
import {
	BUSINESS_TYPES,
	EMAIL_PATTERN,
	LOCALES,
	optionalString,
	readJsonObject,
	requireOneOf,
	requireString,
} from './validate';
import type { BusinessType, Locale } from '#shared/types/domain';
import type { SignupInput } from '../model/users';
import { apiError } from './errors';

const PASSWORD_MAX = 200;

export function parseSignup(body: unknown): SignupInput {
	const root = readJsonObject(body);
	const email = requireString(root, 'email').trim().toLowerCase();
	if (!EMAIL_PATTERN.test(email)) {
		throw apiError(
			400,
			'validation',
			'Field email is not a valid email address',
		);
	}
	const password = requireString(root, 'password');
	if (password.length < 8) {
		throw apiError(
			400,
			'validation',
			'Field password must be at least 8 characters',
		);
	}
	if (password.length > PASSWORD_MAX) {
		throw apiError(400, 'validation', 'Field password is too long');
	}
	const profile = readJsonObject(root.profile);
	const businessType =
		profile.businessType === undefined ?
			'other'
		:	requireOneOf<BusinessType>(profile, 'businessType', BUSINESS_TYPES);
	const locale =
		profile.locale === undefined ?
			'ja'
		:	requireOneOf<Locale>(profile, 'locale', LOCALES);
	return {
		email,
		password,
		name: requireNonblank(profile, 'name'),
		businessName: requireNonblank(profile, 'businessName'),
		businessType,
		otherBusinessType:
			optionalString(profile, 'otherBusinessType')?.trim() || null,
		municipality: requireNonblank(profile, 'municipality'),
		phone: optionalString(profile, 'phone'),
		website: optionalString(profile, 'website'),
		note: optionalString(profile, 'note'),
		locale,
	};
}

function requireNonblank(
	profile: Record<string, unknown>,
	field: string,
): string {
	const value = requireString(profile, field).trim();
	if (!value) {
		throw apiError(400, 'validation', `Field '${field}' is required`);
	}
	return value;
}
