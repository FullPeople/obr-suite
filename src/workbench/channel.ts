/** This migration is deliberately limited to the dev deployment. */
export const WORKBENCH_DEV = /\/suite-dev\//.test(import.meta.env.BASE_URL);
export const WORKBENCH_PROTOCOL = 'full-suite-workbench/v1';
