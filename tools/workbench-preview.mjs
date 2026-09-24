// Local simulation only. No live Owlbear room is connected.
process.env.WORKBENCH_PREVIEW='1';
await import('./workbench-168-selftest.mjs');
