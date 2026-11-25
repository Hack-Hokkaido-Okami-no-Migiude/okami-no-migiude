// Boot plugin: opens/migrates the database before serving traffic, provisions
// staff accounts (§7), and starts the background worker. All steps are
// idempotent, so dev-mode restarts and crash-recovery boots are safe.
import { staffEmails, staffPassword } from '../utils/env';
import { defineNitroPlugin } from '#imports';
import { getDb } from '../utils/db';
import { provisionStaffUsers } from '../model/users';
import { startWorker } from '../worker';

export default defineNitroPlugin(() => {
	getDb();
	provisionStaffUsers(staffEmails(), staffPassword());
	startWorker();
});
