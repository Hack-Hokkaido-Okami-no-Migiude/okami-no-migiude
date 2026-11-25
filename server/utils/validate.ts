// Small hand-written guards (contract §1: no schema/validation library).
// Unknown extra properties in requests are ignored, not rejected (§3).
import type { BusinessType, Locale } from '#shared/types/domain';
import { apiError } from './errors';

export const BUSINESS_TYPES: BusinessType[] = [
	'accommodation',
	'food_service',
	'retail',
	'tourism',
	'agriculture',
	'manufacturing',
	'construction',
	'transport',
	'healthcare',
	'professional_services',
	'other',
];

export const LOCALES: Locale[] = ['ja', 'en'];

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readJsonObject(body: unknown): Record<string, unknown> {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw apiError(400, 'validation', 'Request body must be a JSON object');
	}
	return body as Record<string, unknown>;
}

export function requireString(
	body: Record<string, unknown>,
	key: string,
): string {
	const value = body[key];
	if (typeof value !== 'string') {
		throw apiError(400, 'validation', `Field '${key}' is required`);
	}
	return value;
}

export function optionalString(
	body: Record<string, unknown>,
	key: string,
): string | null {
	const value = body[key];
	if (value === undefined) {
		return null;
	}
	if (typeof value !== 'string') {
		throw apiError(400, 'validation', `Field '${key}' must be a string`);
	}
	return value;
}

export function requireOneOf<T extends string>(
	body: Record<string, unknown>,
	key: string,
	values: readonly T[],
): T {
	const value = body[key];
	if (typeof value !== 'string' || !values.includes(value as T)) {
		throw apiError(
			400,
			'validation',
			`Field '${key}' has an invalid value`,
		);
	}
	return value as T;
}
