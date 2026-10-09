export const SCHEDULED_MAX_ATTEMPTS = 5;
export const SCHEDULED_RETRY_BASE_MS = 30_000;
export const SCHEDULED_RETRY_MAX_MS = 15 * 60_000;

export const scheduledRetryDelayMs = (attemptCount) => {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(
    SCHEDULED_RETRY_MAX_MS,
    SCHEDULED_RETRY_BASE_MS * (2 ** (attempt - 1)),
  );
};

export const scheduledNextRetryAt = (attemptCount, now = new Date()) =>
  new Date(now.getTime() + scheduledRetryDelayMs(attemptCount));
