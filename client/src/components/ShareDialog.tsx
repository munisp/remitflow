/**
 * ShareDialog
 * Social sharing dialog powered by the Rust share-link microservice.
 * Generates short URLs with Open Graph metadata for WhatsApp, Twitter,
 * Facebook, Telegram, and clipboard copy.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Share2, Copy, Check, MessageCircle, Twitter, Facebook,
  Send, Link2, ExternalLink, Loader2, BarChart2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareTarget {
  resourceType: "fund" | "talent" | "listing" | "collective" | "referral";
  resourceId: string;
  title: string;
  description: string;
  imageUrl?: string;
  targetUrl: string;
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget;
}

// ─── Share button config ──────────────────────────────────────────────────────

interface SharePlatform {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  hoverBg: string;
  buildUrl: (shareUrls: Record<string, string>) => string;
}

const PLATFORMS: SharePlatform[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    color: "text-white",
    bg: "bg-[#25D366]",
    hoverBg: "hover:bg-[#20b858]",
    buildUrl: (u) => u.whatsapp,
  },
  {
    id: "twitter",
    label: "Twitter / X",
    icon: Twitter,
    color: "text-white",
    bg: "bg-[#1DA1F2]",
    hoverBg: "hover:bg-[#1a8fd1]",
    buildUrl: (u) => u.twitter,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: Facebook,
    color: "text-white",
    bg: "bg-[#1877F2]",
    hoverBg: "hover:bg-[#1565d8]",
    buildUrl: (u) => u.facebook,
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: Send,
    color: "text-white",
    bg: "bg-[#2CA5E0]",
    hoverBg: "hover:bg-[#2591c7]",
    buildUrl: (u) => u.telegram,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ShareDialog({ open, onOpenChange, target }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<{
    shortUrl: string;
    shareUrls: Record<string, string>;
    slug: string;
  } | null>(null);

  const generateMutation = trpc.shareLink.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedLink({
        shortUrl: data.shortUrl,
        shareUrls: data.shareUrls as Record<string, string>,
        slug: data.slug,
      });
    },
    onError: () => {
      toast.error("Failed to generate share link. Using direct URL.");
      // Fallback: use the target URL directly
      const shortUrl = target.targetUrl;
      const encoded = encodeURIComponent(shortUrl);
      const encodedTitle = encodeURIComponent(target.title);
      setGeneratedLink({
        shortUrl,
        slug: "",
        shareUrls: {
          whatsapp: `https://wa.me/?text=${encodeURIComponent(`\uD83C\uDF0D *${target.title}*\n\n${target.description ? target.description + "\n\n" : ""}\uD83D\uDCB8 Support this community initiative and make a real impact:\n${shortUrl}\n\n_Powered by RemitFlow DiasporaDAO_`)}`,
          twitter: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encoded}`,
          facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
          telegram: `https://t.me/share/url?url=${encoded}&text=${encodedTitle}`,
          copy: shortUrl,
        },
      });
    },
  });

  // Stats for existing links
  const statsQuery = trpc.shareLink.stats.useQuery(
    { slug: generatedLink?.slug ?? "" },
    { enabled: !!generatedLink?.slug, refetchInterval: 10000 }
  );

  // Auto-generate when dialog opens
  const handleOpen = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (isOpen && !generatedLink) {
      generateMutation.mutate({
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        title: target.title,
        description: target.description,
        imageUrl: target.imageUrl,
        targetUrl: target.targetUrl,
        expiresInDays: 30,
      });
    }
  };

  const handleCopy = async () => {
    const url = generatedLink?.shortUrl ?? target.targetUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — please copy manually");
    }
  };

  const handleShare = (platform: SharePlatform) => {
    if (!generatedLink) return;
    const url = platform.buildUrl(generatedLink.shareUrls);
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=500");
    toast.success(`Sharing on ${platform.label}...`);
  };

  const resourceTypeLabel: Record<string, string> = {
    fund: "Community Fund",
    talent: "Talent Profile",
    listing: "Marketplace Listing",
    collective: "Diaspora Collective",
    referral: "Referral",
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-indigo-400" />
            Share {resourceTypeLabel[target.resourceType] ?? "Link"}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {target.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Loading state */}
          {generateMutation.isPending && (
            <div className="flex items-center justify-center py-6 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
              <span className="text-sm text-muted-foreground">Generating share link...</span>
            </div>
          )}

          {/* Generated link */}
          {generatedLink && (
            <>
              {/* Short URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Share Link
                </label>
                <div className="flex gap-2">
                  <Input
                    value={generatedLink.shortUrl}
                    readOnly
                    className="text-sm font-mono bg-muted/50 text-foreground"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    className={cn(
                      "shrink-0 transition-colors",
                      copied && "border-green-500 text-green-500"
                    )}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Stats */}
              {statsQuery.data && generatedLink.slug && (
                <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-muted/30 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <BarChart2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{statsQuery.data.clicks}</span>
                    <span>clicks</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{statsQuery.data.views}</span>
                    <span>views</span>
                  </div>
                  <div className="ml-auto">
                    <Badge variant="outline" className="text-xs">
                      {statsQuery.data.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              )}

              <Separator />

              {/* Social platforms */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Share on
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORMS.map((platform) => {
                    const Icon = platform.icon;
                    return (
                      <Button
                        key={platform.id}
                        onClick={() => handleShare(platform)}
                        className={cn(
                          "justify-start gap-2 font-medium",
                          platform.bg,
                          platform.hoverBg,
                          platform.color,
                          "border-0"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {platform.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* Open Graph preview link */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>Rich preview enabled for social media</span>
                <a
                  href={generatedLink.shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Preview <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Trigger button ───────────────────────────────────────────────────────────

interface ShareButtonProps {
  target: ShareTarget;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  label?: string;
}

export function ShareButton({
  target,
  variant = "outline",
  size = "sm",
  className,
  label = "Share",
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={cn("gap-1.5", className)}
      >
        <Share2 className="h-3.5 w-3.5" />
        {size !== "icon" && label}
      </Button>
      <ShareDialog open={open} onOpenChange={setOpen} target={target} />
    </>
  );
}
