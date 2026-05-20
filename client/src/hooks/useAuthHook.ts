import { useContext } from "react";
import { useAuth as _useAuth } from "@/hooks/useAuth";

export type User = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  avatarUrl?: string;
};

export function useAuth() {
  const ctx = _useAuth() as unknown as { user: any; isLoading: boolean; loginUrl: string };
  return {
    user: ctx?.user as User | null ?? null,
    isLoading: ctx?.isLoading ?? false,
    isAuthenticated: !!ctx?.user,
  };
}
