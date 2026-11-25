import type { CronTask } from 'deepspace/worker'

// Tripboard has no scheduled work; worker.ts still registers the cron room.
export const tasks: CronTask[] = []

export async function runTask(_name: string, _env: unknown): Promise<void> {}
