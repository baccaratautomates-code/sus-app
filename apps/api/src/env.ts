function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export const env = {
  REDIS_URL: required("REDIS_URL"),
  GROQ_API_KEY: required("GROQ_API_KEY"),
  DATABASE_URL: required("DATABASE_URL"),
  WORKER_QUEUE_NAME: process.env.WORKER_QUEUE_NAME ?? "scraper-queue",
};
