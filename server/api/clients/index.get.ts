// GET /api/clients — list all known clients in creation order.
import { defineEventHandler } from 'h3';
import { listClients } from '~~/server/store/repository';
import { runRoute } from '~~/server/utils/http';

export default defineEventHandler((event) =>
	runRoute(event, async () => listClients()),
);
