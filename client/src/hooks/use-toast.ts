/**
 * use-toast.ts — compatibility shim for pages that import from @/hooks/use-toast
 * The project uses sonner for toasts; this re-exports the same API.
 */
import { toast } from "sonner";

export { toast };

export function useToast() {
  return { toast };
}
