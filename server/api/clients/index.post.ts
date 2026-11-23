// POST /api/clients — create a client with a server-assigned id.
import {
	ClientCreateRequestSchema,
	parseJsonBody,
	runRoute,
} from '~~/server/utils/http';
import { defineEventHandler, setResponseStatus } from 'h3';
import { createClient } from '~~/server/store/repository';

export default defineEventHandler((event) =>
	runRoute(event, async () => {
		const body = await parseJsonBody(event, ClientCreateRequestSchema);
		const client = await createClient(body.name);
		setResponseStatus(event, 201);
		return client;
	}),
);
