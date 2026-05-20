/**
 * AuthContext barrel — re-exports useAuth from the canonical location.
 * Many pages import from @/contexts/AuthContext; this file satisfies those imports.
 */
export { useAuth } from "@/hooks/useAuth";
