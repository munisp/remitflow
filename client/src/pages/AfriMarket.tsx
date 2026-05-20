import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShoppingBag, Search, Plus, MapPin, Eye, Package, CheckCircle,
  Store, Tag, Globe, Truck, Shield, Star, AlertTriangle, MessageSquare
} from "lucide-react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "electronics", label: "Electronics" },
  { value: "fashion", label: "Fashion" },
  { value: "food", label: "Food & Groceries" },
  { value: "crafts", label: "Arts & Crafts" },
  { value: "services", label: "Services" },
  { value: "real_estate", label: "Real Estate" },
  { value: "agriculture", label: "Agriculture" },
  { value: "education", label: "Education" },
  { value: "health", label: "Health" },
  { value: "other", label: "Other" },
];

const CURRENCIES = ["USD", "GBP", "EUR", "NGN", "GHS", "KES", "ZAR", "XOF"];

const CATEGORY_COLORS: Record<string, string> = {
  electronics: "bg-blue-100 text-blue-800",
  fashion: "bg-pink-100 text-pink-800",
  food: "bg-green-100 text-green-800",
  crafts: "bg-amber-100 text-amber-800",
  services: "bg-purple-100 text-purple-800",
  real_estate: "bg-orange-100 text-orange-800",
  agriculture: "bg-lime-100 text-lime-800",
  education: "bg-cyan-100 text-cyan-800",
  health: "bg-red-100 text-red-800",
  other: "bg-gray-100 text-gray-800",
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800",
  paid: "bg-blue-100 text-blue-800",
  shipped: "bg-indigo-100 text-indigo-800",
  delivered: "bg-green-100 text-green-800",
  disputed: "bg-red-100 text-red-800",
  refunded: "bg-gray-100 text-gray-800",
  cancelled: "bg-gray-100 text-gray-500",
};

export default function AfriMarket() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [country, setCountry] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [buyerNote, setBuyerNote] = useState("");
  const [rateDialog, setRateDialog] = useState<{ open: boolean; order: any | null }>({ open: false, order: null });
  const [rateForm, setRateForm] = useState({ rating: 5, review: "" });
  const [disputeDialog, setDisputeDialog] = useState<{ open: boolean; order: any | null }>({ open: false, order: null });
  const [disputeReason, setDisputeReason] = useState("");

  // Debounce search
  const handleSearchChange = (v: string) => {
    setSearch(v);
    clearTimeout((window as any)._mktSearchTimer);
    (window as any)._mktSearchTimer = setTimeout(() => { setDebouncedSearch(v); setPage(1); }, 350);
  };

  const queryInput = useMemo(() => ({
    category: category === "all" ? undefined : category,
    country: country || undefined,
    search: debouncedSearch || undefined,
    page,
    pageSize: 12,
  }), [category, country, debouncedSearch, page]);

  const { data: listingsData, isLoading, refetch } = trpc.marketplace.listListings.useQuery(queryInput);
  const { data: myOrders, refetch: refetchOrders } = trpc.marketplace.myOrders.useQuery(undefined, { enabled: !!user });
  const { data: myListings, refetch: refetchMyListings } = trpc.marketplace.myListings.useQuery(undefined, { enabled: !!user });

  // Create listing form state
  const [form, setForm] = useState({
    title: "", description: "", category: "other" as any,
    price: "", currency: "USD", country: "", city: "", imageUrl: "",
  });

  const createListing = trpc.marketplace.createListing.useMutation({
    onSuccess: () => {
      toast.success("Listing created successfully!");
      setCreateOpen(false);
      setForm({ title: "", description: "", category: "other", price: "", currency: "USD", country: "", city: "", imageUrl: "" });
      refetch();
      refetchMyListings();
    },
    onError: (e) => toast.error(e.message),
  });

  const placeOrder = trpc.marketplace.placeOrder.useMutation({
    onSuccess: () => {
      toast.success("Order placed! Escrow hold initiated.");
      setOrderDialogOpen(false);
      setSelectedListing(null);
      setBuyerNote("");
      refetch();
      refetchOrders();
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmDelivery = trpc.marketplace.confirmDelivery.useMutation({
    onSuccess: () => {
      toast.success("Delivery confirmed! Funds released to seller.");
      refetchOrders();
    },
    onError: (e) => toast.error(e.message),
  });

  const rateOrder = trpc.marketplace.rateOrder.useMutation({
    onSuccess: () => {
      toast.success("Rating submitted! Thank you for your feedback.");
      setRateDialog({ open: false, order: null });
      setRateForm({ rating: 5, review: "" });
      refetchOrders();
    },
    onError: (e) => toast.error(e.message),
  });

  const raiseDispute = trpc.marketplace.raiseDispute.useMutation({
    onSuccess: () => {
      toast.success("Dispute raised. Our compliance team will review within 48 hours.");
      setDisputeDialog({ open: false, order: null });
      setDisputeReason("");
      refetchOrders();
    },
    onError: (e) => toast.error(e.message),
  });

  const listings = listingsData?.listings ?? [];
  const total = listingsData?.total ?? 0;
  const totalPages = Math.ceil(total / 12);

  return (

    <DashboardLayout>
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-amber-500/20">
              <Store className="w-6 h-6 text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">AfriMarket</h1>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">P2P Marketplace</Badge>
          </div>
          <p className="text-slate-400 text-sm ml-14">Buy and sell goods & services across Africa and the diaspora</p>
        </div>
        {user && (
          <Button onClick={() => setCreateOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
            <Plus className="w-4 h-4 mr-2" /> Post Listing
          </Button>
        )}
      </div>

      {/* Trust badges */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: Shield, label: "Escrow Protection", desc: "Funds held until delivery confirmed" },
          { icon: Globe, label: "Pan-African Reach", desc: "Buyers & sellers across 54 countries" },
          { icon: Truck, label: "Verified Sellers", desc: "KYC-verified diaspora community" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-3 bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <Icon className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-white">{label}</div>
              <div className="text-xs text-slate-400">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="browse">
        <TabsList className="bg-slate-800/60 border border-slate-700/50 mb-6">
          <TabsTrigger value="browse" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
            <ShoppingBag className="w-4 h-4 mr-2" /> Browse ({total})
          </TabsTrigger>
          {user && (
            <>
              <TabsTrigger value="my-orders" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
                <Package className="w-4 h-4 mr-2" /> My Orders ({myOrders?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="my-listings" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
                <Tag className="w-4 h-4 mr-2" /> My Listings ({myListings?.length ?? 0})
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Browse Tab */}
        <TabsContent value="browse">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search listings..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
            <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
              <SelectTrigger className="w-48 bg-slate-800/60 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value} className="text-white hover:bg-slate-700">{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Filter by country..."
              value={country}
              onChange={(e) => { setCountry(e.target.value); setPage(1); }}
              className="w-44 bg-slate-800/60 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-slate-800/50 rounded-xl h-64 animate-pulse border border-slate-700/50" />
              ))}
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No listings found</p>
              <p className="text-sm mt-1">Try adjusting your filters or be the first to post!</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {listings.map((listing: any) => (
                  <Card key={listing.id} className="bg-slate-800/60 border-slate-700/50 hover:border-amber-500/40 transition-all group cursor-pointer"
                    onClick={() => { setSelectedListing(listing); setOrderDialogOpen(true); }}>
                    {listing.imageUrl ? (
                      <div className="h-40 overflow-hidden rounded-t-lg">
                        <img src={listing.imageUrl} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      </div>
                    ) : (
                      <div className="h-40 bg-gradient-to-br from-amber-900/30 to-slate-800 rounded-t-lg flex items-center justify-center">
                        <ShoppingBag className="w-10 h-10 text-amber-500/40" />
                      </div>
                    )}
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-white text-sm line-clamp-2 flex-1">{listing.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${CATEGORY_COLORS[listing.category] ?? "bg-gray-100 text-gray-800"}`}>
                          {listing.category}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs line-clamp-2 mb-3">{listing.description ?? "No description provided."}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-amber-400 font-bold text-base">
                          {listing.currency} {Number(listing.price).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1 text-slate-500 text-xs">
                          <Eye className="w-3 h-3" /> {listing.viewCount ?? 0}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-slate-500 text-xs">
                        <MapPin className="w-3 h-3" />
                        {listing.city ? `${listing.city}, ` : ""}{listing.country}
                      </div>
                      {listing.sellerName && (
                        <div className="flex items-center gap-1 mt-1 text-slate-500 text-xs">
                          <Star className="w-3 h-3 text-amber-500/60" /> {listing.sellerName}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-8">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700">Previous</Button>
                  <span className="text-slate-400 text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700">Next</Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* My Orders Tab */}
        {user && (
          <TabsContent value="my-orders">
            {!myOrders || myOrders.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No orders yet</p>
                <p className="text-sm mt-1">Browse the marketplace and place your first order.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myOrders.map((order: any) => (
                  <div key={order.id} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white text-sm truncate">{order.listingTitle ?? "Unknown listing"}</div>
                      <div className="text-slate-400 text-xs mt-0.5">{order.listingCountry} · Ordered {new Date(order.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-amber-400 font-bold text-sm">{order.currency} {Number(order.amount).toLocaleString()}</div>
                      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {order.status === "shipped" && (
                        <Button size="sm" onClick={() => confirmDelivery.mutate({ orderId: order.id })}
                          disabled={confirmDelivery.isPending}
                          className="bg-green-600 hover:bg-green-700 text-white">
                          <CheckCircle className="w-3 h-3 mr-1" /> Confirm
                        </Button>
                      )}
                      {order.status === "delivered" && (
                        <Button size="sm" variant="outline" onClick={() => { setRateForm({ rating: 5, review: "" }); setRateDialog({ open: true, order }); }}
                          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10">
                          <Star className="w-3 h-3 mr-1" /> Rate
                        </Button>
                      )}
                      {["paid", "shipped"].includes(order.status) && (
                        <Button size="sm" variant="outline" onClick={() => { setDisputeReason(""); setDisputeDialog({ open: true, order }); }}
                          className="border-red-500/40 text-red-300 hover:bg-red-500/10">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Dispute
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        {/* My Listings Tab */}
        {user && (
          <TabsContent value="my-listings">
            {!myListings || myListings.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <Tag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-lg font-medium">No listings yet</p>
                <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> Post Your First Listing
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myListings.map((listing: any) => (
                  <Card key={listing.id} className="bg-slate-800/60 border-slate-700/50">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-white text-sm line-clamp-2 flex-1">{listing.title}</h3>
                        <Badge className={`text-xs shrink-0 ${listing.status === "active" ? "bg-green-500/20 text-green-300" : listing.status === "sold" ? "bg-blue-500/20 text-blue-300" : "bg-gray-500/20 text-gray-300"}`}>
                          {listing.status}
                        </Badge>
                      </div>
                      <div className="text-amber-400 font-bold">{listing.currency} {Number(listing.price).toLocaleString()}</div>
                      <div className="flex items-center gap-1 mt-1 text-slate-500 text-xs">
                        <MapPin className="w-3 h-3" /> {listing.country}
                        <span className="ml-2"><Eye className="w-3 h-3 inline" /> {listing.viewCount ?? 0} views</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Order / Listing Detail Dialog */}
      <Dialog open={orderDialogOpen} onOpenChange={(o) => { setOrderDialogOpen(o); if (!o) { setSelectedListing(null); setBuyerNote(""); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">{selectedListing?.title}</DialogTitle>
          </DialogHeader>
          {selectedListing && (
            <div className="space-y-4">
              {selectedListing.imageUrl && (
                <img src={selectedListing.imageUrl} alt={selectedListing.title} className="w-full h-48 object-cover rounded-lg" />
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Price</div>
                  <div className="text-amber-400 font-bold text-lg">{selectedListing.currency} {Number(selectedListing.price).toLocaleString()}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-3">
                  <div className="text-slate-400 text-xs mb-1">Location</div>
                  <div className="text-white font-medium">{selectedListing.city ? `${selectedListing.city}, ` : ""}{selectedListing.country}</div>
                </div>
              </div>
              {selectedListing.description && (
                <p className="text-slate-300 text-sm leading-relaxed">{selectedListing.description}</p>
              )}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300">
                <Shield className="w-3 h-3 inline mr-1" />
                Payment is held in escrow until you confirm delivery. Funds are only released to the seller after your confirmation.
              </div>
              {user && selectedListing.sellerId !== user.id && (
                <>
                  <div>
                    <Label className="text-slate-300 text-sm mb-1 block">Message to seller (optional)</Label>
                    <Textarea
                      placeholder="Any special instructions or questions..."
                      value={buyerNote}
                      onChange={(e) => setBuyerNote(e.target.value)}
                      className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500 resize-none"
                      rows={2}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOrderDialogOpen(false)} className="border-slate-600 text-slate-300">Cancel</Button>
                    <Button onClick={() => placeOrder.mutate({ listingId: selectedListing.id, buyerNote: buyerNote || undefined })}
                      disabled={placeOrder.isPending}
                      className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                      {placeOrder.isPending ? "Placing Order..." : "Place Order (Escrow)"}
                    </Button>
                  </DialogFooter>
                </>
              )}
              {!user && (
                <p className="text-center text-slate-400 text-sm py-2">Sign in to place an order.</p>
              )}
              {user && selectedListing.sellerId === user.id && (
                <p className="text-center text-slate-400 text-sm py-2">This is your listing.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rate Order Dialog */}
      <Dialog open={rateDialog.open} onOpenChange={(o) => !o && setRateDialog({ open: false, order: null })}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Rate Your Purchase</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">{rateDialog.order?.listingTitle}</p>
            <div className="space-y-1">
              <Label className="text-slate-300 text-sm">Rating (1–5 stars)</Label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setRateForm(f => ({ ...f, rating: n }))}
                    className={`p-1 rounded transition-colors ${rateForm.rating >= n ? "text-amber-400" : "text-slate-600"}`}>
                    <Star className="w-6 h-6 fill-current" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-sm">Review (optional)</Label>
              <Textarea value={rateForm.review} onChange={e => setRateForm(f => ({ ...f, review: e.target.value }))}
                placeholder="Share your experience with this seller..."
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500 resize-none" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateDialog({ open: false, order: null })} className="border-slate-600 text-slate-300">Cancel</Button>
            <Button onClick={() => rateOrder.mutate({ orderId: rateDialog.order!.id, rating: rateForm.rating, review: rateForm.review || undefined })}
              disabled={rateOrder.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
              {rateOrder.isPending ? "Submitting..." : "Submit Rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raise Dispute Dialog */}
      <Dialog open={disputeDialog.open} onOpenChange={(o) => !o && setDisputeDialog({ open: false, order: null })}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" /> Raise a Dispute</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">{disputeDialog.order?.listingTitle}</p>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">
              Our compliance team will review your dispute within 48 hours. Funds remain in escrow until resolved.
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-sm">Reason for dispute *</Label>
              <Textarea value={disputeReason} onChange={e => setDisputeReason(e.target.value)}
                placeholder="Describe the issue in detail (min 10 characters)..."
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500 resize-none" rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialog({ open: false, order: null })} className="border-slate-600 text-slate-300">Cancel</Button>
            <Button onClick={() => raiseDispute.mutate({ orderId: disputeDialog.order!.id, reason: disputeReason })}
              disabled={raiseDispute.isPending || disputeReason.length < 10}
              className="bg-red-600 hover:bg-red-700 text-white">
              {raiseDispute.isPending ? "Submitting..." : "Submit Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Listing Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Post a New Listing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 text-sm mb-1 block">Title *</Label>
              <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Samsung Galaxy A54, Kente Cloth, Web Dev Services"
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500" />
            </div>
            <div>
              <Label className="text-slate-300 text-sm mb-1 block">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe your item or service in detail..."
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500 resize-none" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm mb-1 block">Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v as any }))}>
                  <SelectTrigger className="bg-slate-800/60 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {CATEGORIES.filter(c => c.value !== "all").map(c => (
                      <SelectItem key={c.value} value={c.value} className="text-white hover:bg-slate-700">{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-sm mb-1 block">Currency *</Label>
                <Select value={form.currency} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="bg-slate-800/60 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {CURRENCIES.map(c => (
                      <SelectItem key={c} value={c} className="text-white hover:bg-slate-700">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm mb-1 block">Price *</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm mb-1 block">Country *</Label>
                <Input value={form.country} onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))}
                  placeholder="e.g. Nigeria"
                  className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm mb-1 block">City</Label>
                <Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="e.g. Lagos"
                  className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500" />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm mb-1 block">Image URL (optional)</Label>
              <Input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://..."
                className="bg-slate-800/60 border-slate-600 text-white placeholder:text-slate-500" />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-slate-600 text-slate-300">Cancel</Button>
            <Button
              onClick={() => {
                if (!form.title || !form.price || !form.country) { toast.error("Please fill in all required fields"); return; }
                createListing.mutate({ ...form, price: Number(form.price), imageUrl: form.imageUrl || undefined, city: form.city || undefined, description: form.description || undefined });
              }}
              disabled={createListing.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
              {createListing.isPending ? "Posting..." : "Post Listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  

    </DashboardLayout>

  );
}
