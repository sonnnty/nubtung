import crypto from 'crypto';

export type JobStatus = 'running' | 'done' | 'error';

export interface Job<T = unknown> {
  id: string;
  name: string;
  status: JobStatus;
  stage: string;
  startedAt: string;
  finishedAt?: string;
  result?: T;
  error?: string;
}

// Kept on globalThis so the registry survives dev hot reloads and is shared between route modules
const globalForJobs = globalThis as unknown as { __nubtangJobs?: Map<string, Job> };
const jobs = (globalForJobs.__nubtangJobs ??= new Map<string, Job>());
const globalForPromises = globalThis as unknown as { __nubtangJobPromises?: Map<string, Promise<void>> };
const jobPromises = (globalForPromises.__nubtangJobPromises ??= new Map<string, Promise<void>>());

const JOB_TTL_MS = 60 * 60 * 1000;

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && Date.parse(job.finishedAt) < cutoff) jobs.delete(id);
  }
}

/**
 * Runs `fn` in the background and returns immediately, so long syncs don't hit reverse-proxy
 * timeouts (Cloudflare cuts requests at ~100s). Only one job per name runs at a time: starting
 * a job whose name is already running returns the running job instead.
 */
export function startJob<T>(name: string, fn: (setStage: (stage: string) => void) => Promise<T>): Job<T> {
  pruneOldJobs();

  const running = getRunningJob(name);
  if (running) return running as Job<T>;

  const job: Job<T> = {
    id: crypto.randomUUID(),
    name,
    status: 'running',
    stage: '',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  const promise = fn(stage => { job.stage = stage; })
    .then(result => {
      job.result = result;
      job.status = 'done';
    })
    .catch((err: unknown) => {
      console.error(`[Job ${name}] failed:`, err);
      job.error = err instanceof Error ? err.message : String(err);
      job.status = 'error';
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      jobPromises.delete(job.id);
    });
  jobPromises.set(job.id, promise);

  return job;
}

export function getRunningJob(name: string): Job | undefined {
  for (const job of jobs.values()) {
    if (job.name === name && job.status === 'running') return job;
  }
  return undefined;
}

/** Resolves once the job has finished (successfully or not). */
export async function waitForJob(id: string): Promise<Job | undefined> {
  await jobPromises.get(id);
  return jobs.get(id);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
