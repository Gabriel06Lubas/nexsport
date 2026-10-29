import type { DefaultSession } from "next-auth";

import type { UserRole } from "@/generated/prisma/enums";

declare module "next-auth" {
  /** Fields the adapter loads from the User table. */
  interface User {
    role?: UserRole;
    activeClubId?: string | null;
    onboardedAt?: Date | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      role: UserRole;
      activeClubId: string | null;
      onboarded: boolean;
    } & DefaultSession["user"];
  }
}
