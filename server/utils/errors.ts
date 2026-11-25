// Contract §6: errors are h3 createError with data: { error, message } so the
// machine code surfaces at data.error on the wire. Messages are static, short
// and human-readable — never upstream errors or transcript excerpts.
import { createError } from 'h3';

const STATUS_TEXT: Record<number, string> = {
	400: 'Validation Failed',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	409: 'Conflict',
	500: 'Internal Server Error',
};

export function apiError(status: number, code: string, message: string): Error {
	return createError({
		statusCode: status,
		statusMessage: STATUS_TEXT[status] ?? 'Error',
		message,
		data: { error: code, message },
	});
}

export function isApiError(error: unknown): boolean {
	return Boolean(
		(error as { data?: { error?: unknown } } | null | undefined)?.data
			?.error,
	);
}

/** Truncates and flattens an error into a safe one-line reason string. */
export function sanitizeError(error: unknown): string {
	const raw =
		error instanceof Error ?
			error.message
		:	String(error ?? 'unknown error');
	const flattened = raw.replace(/\s+/g, ' ').trim() || 'unknown error';
	return flattened.length > 200 ? `${flattened.slice(0, 197)}...` : flattened;
}
