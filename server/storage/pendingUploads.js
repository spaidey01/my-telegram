import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const PENDING_PREFIX = "pending/";
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

const s3 = () => new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

export const cleanupPendingUploads = async (maxAgeMs = DEFAULT_MAX_AGE_MS) => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) return 0;

  const cutoff = Date.now() - maxAgeMs;
  let continuationToken;
  let deleted = 0;

  do {
    const page = await s3().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: PENDING_PREFIX,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    const staleKeys = (page.Contents || [])
      .filter((object) => object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
      .map((object) => ({ Key: object.Key }));

    if (staleKeys.length) {
      await s3().send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: staleKeys, Quiet: true },
      }));
      deleted += staleKeys.length;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
};
