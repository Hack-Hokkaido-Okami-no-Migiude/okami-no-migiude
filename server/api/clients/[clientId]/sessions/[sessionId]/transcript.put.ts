// PUT …/sessions/:sessionId/transcript — create/replace the pasted transcript.
// Existing rows are edited by id (sourceRev bumps only when content changes),
// new rows are appended in array order, and citations that no longer validate
// after the edit are stripped with staleness recomputed for derived artifacts.
import {
	TranscriptPutRequestSchema,
	parseJsonBody,
	requireParam,
	runRoute,
} from '~~/server/utils/http';
import { applyTranscriptInput } from '~~/server/store/transcript';
import { commitSessionMutation } from '~~/server/store/commit-session';
import { defineEventHandler } from 'h3';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, TranscriptPutRequestSchema);
		return commitSessionMutation(
			{
				clientId: requireParam(event, 'clientId'),
				sessionId: requireParam(event, 'sessionId'),
			},
			body.baseRev,
			(current) => ({
				session: {
					...current.session,
					transcript: applyTranscriptInput(
						current.session.transcript,
						body.segments,
					).transcript,
				},
			}),
			{ cascadeCitations: true },
		);
	}),
);
