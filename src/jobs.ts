import type { Job, JobContext } from 'deepspace/worker'

// Tripboard has no background jobs; worker.ts still registers the job room.
export async function runJob(
  _job: Job,
  _ctx: JobContext,
  _env: unknown,
): Promise<void> {}
