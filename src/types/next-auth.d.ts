import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      memberId?: number;
      memberName?: string;
      role?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    memberId?: number;
    memberName?: string;
    role?: string;
  }
}
