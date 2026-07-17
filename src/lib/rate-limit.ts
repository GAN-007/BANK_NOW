import { hashValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";

export async function consumeRateLimit(input: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const now = new Date();
  const bucketStart = Math.floor(now.getTime() / (input.windowSeconds * 1000));
  const windowEnds = new Date((bucketStart + 1) * input.windowSeconds * 1000);
  const key = hashValue(input.scope + ":" + input.identifier + ":" + bucketStart);

  const bucket = await getDb().rateLimitBucket.upsert({
    where: { key },
    create: {
      key,
      count: 1,
      windowEnds,
    },
    update: {
      count: { increment: 1 },
      windowEnds,
    },
  });

  return {
    allowed: bucket.count <= input.limit,
    remaining: Math.max(input.limit - bucket.count, 0),
    retryAfterSeconds: Math.max(
      Math.ceil((windowEnds.getTime() - now.getTime()) / 1000),
      1,
    ),
  };
}
