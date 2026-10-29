-- Step 2: OAuth-only sign-in with hashed, server-side sessions.
--
-- Existing sessions stored raw tokens and cannot be converted to hashes, so
-- they are revoked: everyone signs in again once after this migration.
DELETE FROM "Session";

-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "access_token",
DROP COLUMN "expires_at",
DROP COLUMN "id_token",
DROP COLUMN "refresh_token",
DROP COLUMN "scope",
DROP COLUMN "session_state",
DROP COLUMN "token_type";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "sessionToken",
DROP COLUMN "updatedAt",
ADD COLUMN     "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ADD COLUMN     "userAgent" VARCHAR(512);

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordHash",
ADD COLUMN     "onboardedAt" TIMESTAMPTZ(3);

-- DropTable
DROP TABLE "VerificationToken";

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- Session tokens are stored as lowercase hex SHA-256 digests, never raw.
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_tokenHash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
