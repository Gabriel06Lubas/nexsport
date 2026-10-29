import type { DefaultSession } from "next-auth";

import type { UserRole } from "@/db/schema/enums";

declare module "next-auth" {
  /** Fields the adapter loads from the User table. */
  interface User {
    role?: UserRole;
    activeClubId?: string | null;
    onboardedAt?: Date | null;
    emailVerified?: Date | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      role: UserRole;
      activeClubId: string | null;
      onboarded: boolean;
      /** The user confirmed their email with a code we sent. */
      emailConfirmed: boolean;
    } & DefaultSession["user"];
  }
}
