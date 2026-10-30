import { runSweep } from '../server/utils/sweeps.js';

/* Every minute: retry erasures, remove what retention says is old, forget old rate-limit attempts. See server/utils/sweeps.js. */
export default async () => {
  await runSweep();
};
