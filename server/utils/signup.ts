// Signup body validation (§5): email trimmed + lowercased matching the simple
// pattern, password at least 8 characters, otherBusinessType required iff
// businessType is 'other', locale ja|en. Optional profile fields normalize
// omission to null; unknown extra properties are ignored.
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
	const businessType = requireOneOf<BusinessType>(
		profile,
		'businessType',
		BUSINESS_TYPES,
	);
	const locale = requireOneOf<Locale>(profile, 'locale', LOCALES);
	let otherBusinessType: string | null = null;
	if (businessType === 'other') {
		const value = profile.otherBusinessType;
		if (typeof value !== 'string' || value.trim().length === 0) {
			throw apiError(
				400,
				'validation',
				"Field otherBusinessType is required when businessType is 'other'",
			);
		}
		otherBusinessType = value.trim();
	} else if (typeof profile.otherBusinessType === 'string') {
		otherBusinessType = profile.otherBusinessType.trim() || null;
	}
	return {
		email,
		password,
		name: requireString(profile, 'name'),
		businessName: requireString(profile, 'businessName'),
		businessType,
		otherBusinessType,
		municipality: requireString(profile, 'municipality'),
		phone: optionalString(profile, 'phone'),
		website: optionalString(profile, 'website'),
		note: optionalString(profile, 'note'),
		locale,
	};
}
