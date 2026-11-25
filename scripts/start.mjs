// Production demo listens locally unless the operator explicitly opts out.
process.env.NITRO_HOST ||= process.env.HOST || '127.0.0.1';
await import('../.output/server/index.mjs');
