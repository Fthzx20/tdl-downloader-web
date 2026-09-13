"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search as SearchIcon,
  Download,
  Music,
  Disc,
  ListMusic,
  User,
  Loader2,
  LogIn,
  LogOut,
  Settings,
  X,
  HardDriveDownload,
  Menu,
  Headphones,
  Waves,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  RotateCcw,
  Trash2,
  List,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import {
  getAuthStatus,
  getLoginUrl,
  logoutUser,
  search,
  getDownloadUrl,
  exchangeCode,
  getSettings,
  updateSettings,
  getProgress,
  getAlbumTracks,
  getPlaylistTracks,
  clearServerCache,
} from "@/lib/api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

/* ─── Types ─── */
type ActiveDownload = {
  taskId: string;
  title: string;
  progress: number;
  statusText: string;
  speedText?: string;
  isComplete: boolean;
  isError: boolean;
  item?: any;
  itemType?: string;
  abortController?: AbortController;
};

/* ─── Helper: Get cover image URL from Tidal data ─── */
function getCoverUrl(item: any, type: string): string | null {
  if (!item) return null;
  let coverId: string | null = null;
  if (type === "tracks" && item.album?.cover) coverId = item.album.cover;
  else if (type === "albums" && item.cover) coverId = item.cover;
  else if (type === "playlists" && (item.squareImage || item.image))
    coverId = item.squareImage || item.image;
  else if (type === "artists" && item.picture) coverId = item.picture;

  // Fallbacks if specific key is missing
  if (!coverId) {
    coverId =
      item.album?.cover ||
      item.cover ||
      item.squareImage ||
      item.image ||
      item.picture ||
      null;
  }

  if (!coverId) return null;
  return `https://resources.tidal.com/images/${coverId.replace(/-/g, "/")}/320x320.jpg`;
}

/* ─── Helper: Get artist text ─── */
function getArtistText(item: any, type: string): string {
  if (type === "tracks" || type === "albums") {
    return item.artists?.map((a: any) => a.name).join(", ") || item.artist?.name || "Unknown Artist";
  }
  if (type === "playlists") return item.creator?.name || "Playlist";
  return "";
}

/* ─── Helper: Get subtitle info ─── */
function getSubtitle(item: any, type: string): string {
  if (type === "tracks") {
    const dur = item.duration;
    if (dur) {
      const m = Math.floor(dur / 60);
      const s = dur % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    }
    return "";
  }
  if (type === "albums") {
    const n = item.numberOfTracks;
    return n ? `${n} track${n !== 1 ? "s" : ""}` : "";
  }
  if (type === "playlists") {
    const n = item.numberOfTracks;
    return n ? `${n} track${n !== 1 ? "s" : ""}` : "";
  }
  return "";
}

/* ─── Main Component ─── */
export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<{ username?: string; user_id?: string; country?: string } | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("tracks");
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [showPasteInput, setShowPasteInput] = useState(false);
  const [authUrl, setAuthUrl] = useState("");

  const [settings, setSettings] = useState({
    quality_tier: "LOSSLESS",
    allow_dolby_atmos: false,
    r2_enabled: false,
    r2_account_id: "",
    r2_access_key_id: "",
    r2_secret_access_key: "",
    r2_bucket_name: "",
    r2_public_domain: "",
    r2_configured: false,
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [showDownloads, setShowDownloads] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Track Selector Modal State
  const [selectedCollection, setSelectedCollection] = useState<{ type: "albums" | "playlists"; item: any } | null>(null);
  const [collectionTracks, setCollectionTracks] = useState<any[]>([]);
  const [isLoadingCollectionTracks, setIsLoadingCollectionTracks] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);

  /* ─── Effects ─── */
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const fetchAuth = useCallback(() => {
    getAuthStatus()
      .then((res) => {
        if (res.authenticated) {
          setIsAuthenticated(true);
          setUserInfo({
            username: res.username || (res.user_id ? `User #${res.user_id}` : "Tidal Account"),
            user_id: res.user_id,
            country: res.country,
          });
          localStorage.setItem("tdl_auth", "true");
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem("tdl_auth");
        }
      })
      .catch(() => {
        const stored = localStorage.getItem("tdl_auth");
        if (stored) setIsAuthenticated(true);
      });
  }, []);

  useEffect(() => {
    // Seamless Auto-Login: Check backend for saved session token
    fetchAuth();
  }, [fetchAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem("tdl_auth", "true");
      fetchAuth();
      getSettings().then(setSettings).catch(console.error);
    }
  }, [isAuthenticated, fetchAuth]);

  // Auto Refresh Search as user types (debounced live search)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      handleSearch(undefined, type);
    }, 400);
    return () => clearTimeout(timer);
  }, [query, type]);

  // Polling for server-side progress & live download speed
  useEffect(() => {
    const incomplete = activeDownloads.filter(
      (d) => !d.isComplete && !d.isError && d.progress < 100
    );
    if (incomplete.length === 0) return;

    const interval = setInterval(() => {
      incomplete.forEach(async (d) => {
        try {
          const res = await getProgress(d.taskId);
          if (res.status === "active" && res.tracks) {
            const trackList = Object.values(res.tracks) as any[];
            const totalTracks = trackList.length;
            const finished = trackList.filter(
              (t: any) => t.downloaded >= t.total && t.total > 0
            ).length;

            let liveSpeed = "";
            let singleTrackStatus = "";
            let calculatedPct = 0;

            if (totalTracks === 1) {
              const trk = trackList[0];
              if (trk) {
                if (trk.status) singleTrackStatus = trk.status;
                if (trk.total > 0 && trk.downloaded > 0) {
                  calculatedPct = Math.min(99, Math.round((trk.downloaded / trk.total) * 100));
                }
              }
            } else if (totalTracks > 1) {
              calculatedPct = Math.round((finished / totalTracks) * 100);
            }

            for (const t of trackList) {
              if (t.status && (t.status.includes("MB/s") || t.status.includes("KB/s"))) {
                const match = t.status.match(/\(([\d.]+\s*(?:MB|KB)\/s)\)/);
                if (match) {
                  liveSpeed = match[1];
                  break;
                }
              }
            }

            const statusMsg =
              totalTracks > 1
                ? `Downloading · ${finished}/${totalTracks} tracks`
                : singleTrackStatus || (liveSpeed ? `Downloading from Tidal` : "Downloading from Tidal...");

            updateDownload(d.taskId, {
              statusText: statusMsg,
              speedText: liveSpeed,
              progress: calculatedPct > 0 ? calculatedPct : d.progress,
            });
          }
        } catch {
          // Silently ignore polling errors
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeDownloads]);

  /* ─── State Helpers ─── */
  const updateDownload = useCallback(
    (taskId: string, updates: Partial<ActiveDownload>) => {
      setActiveDownloads((prev) =>
        prev.map((d) => (d.taskId === taskId ? { ...d, ...updates } : d))
      );
    },
    []
  );

  /* ─── Handlers ─── */
  const handleLogin = async () => {
    try {
      const { login_url } = await getLoginUrl();
      window.open(login_url, "_blank");
      setShowPasteInput(true);
    } catch {
      toast.error("Failed to connect to backend. Is the server running?");
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUrl.trim()) return;
    setIsLoading(true);
    let code = authUrl.trim();
    try {
      if (code.startsWith("http")) {
        const urlObj = new URL(code);
        code = urlObj.searchParams.get("code") || code;
      }
    } catch {
      /* not a URL */
    }
    exchangeCode(code)
      .then(() => {
        setIsAuthenticated(true);
        toast.success("Connected to Tidal!");
        setShowPasteInput(false);
      })
      .catch(() =>
        toast.error("Authentication failed. Make sure the URL is correct.")
      )
      .finally(() => setIsLoading(false));
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      /* ignore error on network fail */
    }
    setIsAuthenticated(false);
    setUserInfo(null);
    localStorage.removeItem("tdl_auth");
    toast.success("Logged out of Tidal");
  };

  const handleSearch = async (
    e?: React.FormEvent,
    searchType: string = type
  ) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    setIsLoading(true);
    try {
      const data = await search(query, searchType);
      if (data.resolved_type && data.resolved_type !== searchType) {
        setType(data.resolved_type);
      }
      setResults(data.items || []);
    } catch (err: any) {
      if (err?.message === "NOT_AUTHENTICATED") {
        toast.error("Please log in to Tidal first. Open Settings → Account to connect.");
        setIsAuthenticated(false);
        localStorage.removeItem("tdl_auth");
      } else {
        toast.error("Search failed. Check your backend connection.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (val: string) => {
    setType(val);
    if (query.trim()) handleSearch(undefined, val);
  };

  const handleSettingChange = async (key: string, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await updateSettings(updated);
      toast.success("Preferences auto-saved", { duration: 1500 });
    } catch {
      toast.error("Failed to save settings");
    }
  };

  const handleDownload = async (item: any, overrideType?: string) => {
    const downloadType =
      overrideType || (type === "tracks" ? "track" : type === "albums" ? "album" : "playlist");
    const taskId = Math.random().toString(36).substring(7);
    const itemId = item.id || item.uuid;
    const url = `${getDownloadUrl(downloadType, itemId)}?task_id=${taskId}`;
    const itemTitle = item.title || item.name;

    setShowDownloads(true);
    setActiveDownloads((prev) => [
      ...prev,
      {
        taskId,
        title: itemTitle,
        progress: 0,
        statusText: "Preparing...",
        isComplete: false,
        isError: false,
        item,
        itemType: downloadType,
      },
    ]);

    try {
      // Trigger native browser download directly to stream to disk without loading file chunks into JS heap
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast.success(`Queued download for "${itemTitle}"`);
    } catch (err: any) {
      const msg = err?.message || `Failed to download "${itemTitle}"`;
      updateDownload(taskId, {
        statusText: "Failed",
        isError: true,
        isComplete: true,
      });
      toast.error(msg);
    }
  };

  const handleCancelDownload = (taskId: string) => {
    const target = activeDownloads.find((d) => d.taskId === taskId);
    if (target && target.abortController) {
      try {
        target.abortController.abort();
      } catch {}
    } else {
      updateDownload(taskId, {
        statusText: "Cancelled",
        isError: true,
        isComplete: true,
        progress: 0,
      });
      toast.info("Download cancelled");
    }
  };

  const handleClearServerCache = async () => {
    try {
      await clearServerCache();
      toast.success("Server cache cleared successfully");
    } catch {
      toast.error("Failed to clear server cache");
    }
  };

  const clearCompletedDownloads = () => {
    setActiveDownloads((prev) => prev.filter((d) => !d.isComplete));
    toast.success("Download history cleared");
  };

  const handleOpenCollection = async (item: any, collectionType: "albums" | "playlists") => {
    setSelectedCollection({ type: collectionType, item });
    setIsLoadingCollectionTracks(true);
    setCollectionTracks([]);
    setSelectedTrackIds([]);
    try {
      const collectionId = item.id || item.uuid;
      const res = collectionType === "albums" ? await getAlbumTracks(collectionId) : await getPlaylistTracks(collectionId);
      const rawItems = res.items || [];
      const tracks = rawItems
        .map((t: any) => (t.item ? t.item : t))
        .filter((t: any) => {
          if (!t || !t.id) return false;
          if (t.type === "VIDEO" || t.type === "Video" || t.type === "MUSIC_VIDEO") return false;
          if (t.streamReady === false || t.allowStreaming === false) return false;
          return true;
        });
      setCollectionTracks(tracks);
      setSelectedTrackIds(tracks.map((t: any) => String(t.id)));
    } catch (err: any) {
      if (err?.message === "NOT_AUTHENTICATED") {
        toast.error("Please log in to Tidal first. Open Settings → Account to connect.");
        setIsAuthenticated(false);
        localStorage.removeItem("tdl_auth");
        setSelectedCollection(null);
      } else {
        toast.error(err?.message || "Failed to load tracklist");
      }
    } finally {
      setIsLoadingCollectionTracks(false);
    }
  };

  const handleToggleSelectTrack = (trackId: string) => {
    setSelectedTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  };

  const handleToggleSelectAllTracks = () => {
    if (selectedTrackIds.length === collectionTracks.length) {
      setSelectedTrackIds([]);
    } else {
      setSelectedTrackIds(collectionTracks.map((t) => String(t.id)));
    }
  };

  const handleDownloadSelectedTracks = async () => {
    if (selectedTrackIds.length === 0) {
      toast.error("Select at least one track to download");
      return;
    }
    const tracksToDownload = collectionTracks.filter((t) => selectedTrackIds.includes(String(t.id)));
    setSelectedCollection(null);

    const total = tracksToDownload.length;
    let successCount = 0;
    let failCount = 0;
    const failedTracks: any[] = [];

    toast.info(`Queued ${total} tracks for download`);

    for (let i = 0; i < tracksToDownload.length; i++) {
      const track = tracksToDownload[i];
      try {
        await handleDownload(track, "track");
        successCount++;
      } catch {
        failCount++;
        failedTracks.push(track);
      }
      // Breathing room: let the server clean up files and the browser GC blobs
      if (i < tracksToDownload.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Auto-retry failed tracks once
    if (failedTracks.length > 0 && failedTracks.length < total) {
      toast.info(`Retrying ${failedTracks.length} failed track(s)...`);
      await new Promise((r) => setTimeout(r, 2000));
      for (const track of failedTracks) {
        try {
          await handleDownload(track, "track");
          successCount++;
          failCount--;
        } catch {
          // Still failed after retry
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Summary toast
    if (failCount > 0) {
      toast.warning(`Batch complete: ${successCount} downloaded, ${failCount} failed out of ${total}`);
    } else if (total > 1) {
      toast.success(`All ${total} tracks downloaded successfully!`);
    }
  };

  const pendingCount = activeDownloads.filter((d) => !d.isComplete).length;

  /* ════════════════════════════════════════════════════════════════════════
     LOGIN SCREEN / HYDRATION GUARD
  ════════════════════════════════════════════════════════════════════════ */
  if (!hasMounted) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background relative overflow-hidden px-4">
        {/* Ambient background orbs */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/15 blur-[150px] rounded-full pointer-events-none animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-chart-3/10 blur-[120px] rounded-full pointer-events-none animate-float" style={{ animationDelay: "-3s" }} />

        <div className="relative z-10 w-full max-w-sm animate-slide-up-fade">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center mb-5 shadow-lg shadow-primary/10">
              <Waves className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">TDL Rip</h1>
            <p className="text-muted-foreground">
              Studio-quality music, one click away
            </p>
          </div>

          {/* Card */}
          <div className="glass-strong rounded-3xl border border-white/[0.06] p-6 space-y-5 shadow-2xl">
            {!showPasteInput ? (
              <>
                <Button
                  className="w-full h-14 text-base font-semibold rounded-2xl bg-primary text-primary-foreground hover:brightness-110 shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                  onClick={handleLogin}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  ) : (
                    <LogIn className="w-5 h-5 mr-2" />
                  )}
                  Connect with Tidal
                </Button>
                <p className="text-xs text-center text-muted-foreground/70">
                  Requires an active Tidal Premium subscription
                </p>
              </>
            ) : (
              <form onSubmit={handlePasteSubmit} className="space-y-4">
                <div className="flex items-center gap-2 bg-primary/10 text-primary text-sm px-3 py-2 rounded-xl border border-primary/20">
                  <Headphones className="w-4 h-4 shrink-0" />
                  <span>
                    Log in on the new tab, then paste the redirect URL below
                  </span>
                </div>
                <Input
                  value={authUrl}
                  onChange={(e) => setAuthUrl(e.target.value)}
                  placeholder="https://login.tidal.com/..."
                  className="h-12 rounded-xl bg-white/[0.04] border-white/[0.08] text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-primary/50"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowPasteInput(false)}
                    className="flex-1 h-11 rounded-xl"
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || !authUrl.trim()}
                    className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground hover:brightness-110"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     MAIN APP
  ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="flex min-h-screen min-h-dvh bg-background relative overflow-x-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="w-[260px] border-r border-white/[0.06] bg-sidebar hidden lg:flex flex-col shrink-0 sticky top-0 h-screen">
        {/* Brand */}
        <div className="p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center">
            <Waves className="w-5 h-5 text-primary" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight block leading-none">
              TDL Rip
            </span>
            <span className="text-[11px] text-muted-foreground/60 font-medium">
              Web Edition
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          <Button
            variant="secondary"
            className="w-full justify-start font-medium h-10 rounded-xl"
          >
            <SearchIcon className="w-4 h-4 mr-3" /> Search
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start font-medium h-10 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => setShowDownloads(!showDownloads)}
          >
            <HardDriveDownload className="w-4 h-4 mr-3" />
            Transfers
            {pendingCount > 0 && (
              <span className="ml-auto bg-primary text-primary-foreground text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center animate-progress-pulse">
                {pendingCount}
              </span>
            )}
          </Button>
        </nav>

        {/* Settings and Account at bottom */}
        <div className="p-3 border-t border-white/[0.06] space-y-2">
          {/* User Account Badge */}
          {userInfo && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate text-foreground">
                    {userInfo.username || "Tidal Account"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 truncate">
                    {userInfo.user_id ? `ID: ${userInfo.user_id}` : "Connected"}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                title="Log Out"
                className="w-7 h-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 ml-1"
              >
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger className="w-full flex items-center justify-start px-3 font-medium h-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors text-sm">
              <Settings className="w-4 h-4 mr-3" /> Settings
            </DialogTrigger>
            <SettingsDialog
              settings={settings}
              onSettingChange={handleSettingChange}
              userInfo={userInfo}
              onLogout={handleLogout}
            />
          </Dialog>
        </div>
      </aside>

      {/* ── Mobile Top Bar ── */}
      <div className="fixed top-0 left-0 right-0 z-40 lg:hidden glass-strong border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center">
              <Waves className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-base tracking-tight">TDL Rip</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9 rounded-full relative"
              onClick={() => setShowDownloads(!showDownloads)}
            >
              <HardDriveDownload className="w-4 h-4" />
              {pendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </Button>
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
              <DialogTrigger className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                <Settings className="w-4 h-4" />
              </DialogTrigger>
              <SettingsDialog
                settings={settings}
                onSettingChange={handleSettingChange}
                userInfo={userInfo}
                onLogout={handleLogout}
              />
            </Dialog>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col min-w-0 relative overflow-x-hidden">
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/[0.04] blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-1/3 left-0 w-[400px] h-[400px] bg-chart-3/[0.03] blur-[120px] rounded-full pointer-events-none" />

        {/* Search Header */}
        <header className="sticky top-0 lg:top-0 pt-[72px] lg:pt-0 z-30">
          <div className="px-4 md:px-8 py-4 md:py-5 glass border-b border-white/[0.06]">
            <form
              onSubmit={handleSearch}
              className="max-w-2xl mx-auto flex items-center gap-2"
            >
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search titles, paste Tidal link, or playlist UUID..."
                  className="w-full pl-10 h-11 md:h-12 rounded-xl bg-white/[0.04] border-white/[0.08] text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-primary/50 text-sm md:text-base"
                />
              </div>
              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 md:h-12 md:w-12 rounded-xl bg-primary hover:brightness-110 shadow-lg shadow-primary/20 shrink-0 active:scale-95 transition-all"
              >
                <SearchIcon className="w-4 h-4 text-primary-foreground" />
              </Button>
            </form>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6">
            {/* Category Tabs */}
            <Tabs
              value={type}
              onValueChange={handleTabChange}
              className="mb-6 flex justify-center w-full"
            >
              <TabsList className="grid grid-cols-4 w-full max-w-md mx-auto h-11 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <TabsTrigger
                  value="tracks"
                  className="rounded-lg text-[11px] sm:text-xs md:text-sm font-medium flex items-center justify-center min-w-0 h-full"
                >
                  <Music className="w-3.5 h-3.5 mr-1.5 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Tracks</span>
                </TabsTrigger>
                <TabsTrigger
                  value="albums"
                  className="rounded-lg text-[11px] sm:text-xs md:text-sm font-medium flex items-center justify-center min-w-0 h-full"
                >
                  <Disc className="w-3.5 h-3.5 mr-1.5 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Albums</span>
                </TabsTrigger>
                <TabsTrigger
                  value="playlists"
                  className="rounded-lg text-[11px] sm:text-xs md:text-sm font-medium flex items-center justify-center min-w-0 h-full"
                >
                  <ListMusic className="w-3.5 h-3.5 mr-1.5 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Playlists</span>
                </TabsTrigger>
                <TabsTrigger
                  value="artists"
                  className="rounded-lg text-[11px] sm:text-xs md:text-sm font-medium flex items-center justify-center min-w-0 h-full"
                >
                  <User className="w-3.5 h-3.5 mr-1.5 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Artists</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Results Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.04] animate-pulse"
                    >
                      <Skeleton className="w-14 h-14 md:w-16 md:h-16 rounded-xl shrink-0" />
                      <div className="space-y-2 flex-1 min-w-0">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))
                : results.length > 0
                  ? results.map((item, idx) => (
                      <div
                        key={`${type}-${item.id || item.uuid || idx}-${idx}`}
                        className="group flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-primary/20 transition-all duration-200 cursor-pointer animate-slide-up-fade"
                        style={{ animationDelay: `${Math.min(idx * 40, 300)}ms` }}
                      >
                        {/* Cover Art */}
                        <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl bg-white/[0.04] overflow-hidden flex-shrink-0 relative">
                          {getCoverUrl(item, type) ? (
                            <img
                              src={getCoverUrl(item, type)!}
                              alt={item.title || item.name || "Cover"}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/15 to-primary/5">
                              <Music className="w-6 h-6 text-primary/40" />
                            </div>
                          )}
                          {/* Hover overlay — download icon */}
                          {type !== "artists" && (
                            <div
                              className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(item);
                              }}
                            >
                              <Download className="w-5 h-5 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Text Info */}
                        <div className="flex-1 min-w-0 py-0.5">
                          <h3
                            className="font-medium text-sm md:text-base truncate text-foreground/90 group-hover:text-foreground transition-colors"
                            title={item.title || item.name}
                          >
                            {item.title || item.name}
                          </h3>
                          <p className="text-xs md:text-sm text-muted-foreground truncate mt-0.5">
                            {getArtistText(item, type)}
                          </p>
                          {getSubtitle(item, type) && (
                            <p className="text-[11px] text-muted-foreground/50 mt-0.5 font-mono">
                              {getSubtitle(item, type)}
                            </p>
                          )}
                        </div>

                        {/* Action buttons — visible on mobile always, on desktop on hover */}
                        {type !== "artists" && (
                          <div className="flex items-center gap-1 shrink-0">
                            {(type === "albums" || type === "playlists") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-9 h-9 md:w-10 md:h-10 rounded-xl shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 md:opacity-0 md:group-hover:opacity-100 transition-all active:scale-90"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCollection(item, type as "albums" | "playlists");
                                }}
                                title="View & select tracks"
                              >
                                <ListMusic className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-9 h-9 md:w-10 md:h-10 rounded-xl shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 md:opacity-0 md:group-hover:opacity-100 transition-all active:scale-90"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(item);
                              }}
                              title={type === "tracks" ? "Download track" : "Download full zip"}
                            >
                              <Download className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))
                  : query && !isLoading
                    ? (
                        <div className="col-span-full text-center py-16 md:py-24">
                          <Disc className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
                          <p className="text-muted-foreground text-sm md:text-base">
                            No results for &ldquo;{query}&rdquo;
                          </p>
                          <p className="text-muted-foreground/50 text-xs mt-1">
                            Try a different search term
                          </p>
                        </div>
                      )
                    : (
                        <div className="col-span-full text-center py-16 md:py-24">
                          <div className="w-20 h-20 mx-auto mb-5 rounded-3xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                            <Headphones className="w-8 h-8 text-muted-foreground/25" />
                          </div>
                          <p className="text-muted-foreground/70 text-sm md:text-base font-medium">
                            Search for your favorite music
                          </p>
                          <p className="text-muted-foreground/40 text-xs mt-1">
                            Download tracks, albums &amp; playlists in Hi-Res FLAC
                          </p>
                        </div>
                      )}
            </div>
          </div>
        </div>
      </main>

      {/* ════════════════════════════════════════════════════════════════════
          TRACK SELECTION DIALOG
      ════════════════════════════════════════════════════════════════════ */}
      <TrackSelectionDialog
        collection={selectedCollection}
        tracks={collectionTracks}
        isLoading={isLoadingCollectionTracks}
        selectedTrackIds={selectedTrackIds}
        onToggleSelectTrack={handleToggleSelectTrack}
        onToggleSelectAll={handleToggleSelectAllTracks}
        onDownloadSelected={handleDownloadSelectedTracks}
        onSingleDownload={(track) => handleDownload(track, "track")}
        onClose={() => setSelectedCollection(null)}
      />

      {/* ════════════════════════════════════════════════════════════════════
          TRANSFER MANAGER — Floating Panel
      ════════════════════════════════════════════════════════════════════ */}
      {showDownloads && (
        <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-[380px] glass-strong border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col max-h-[70vh] z-50 animate-slide-up-fade">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
                <HardDriveDownload className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-semibold text-sm">Transfers</span>
              {pendingCount > 0 && (
                <span className="text-[11px] text-muted-foreground bg-white/[0.06] px-2 py-0.5 rounded-full">
                  {pendingCount} active
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 rounded-full hover:bg-white/10 text-muted-foreground hover:text-primary"
                onClick={handleClearServerCache}
                title="Clear server cache"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
              {activeDownloads.some((d) => d.isComplete) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                  onClick={clearCompletedDownloads}
                  title="Clear history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 rounded-full hover:bg-white/10"
                onClick={() => setShowDownloads(false)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Download Items */}
          <div className="overflow-y-auto p-3 space-y-2 flex-1">
            {activeDownloads.length === 0 ? (
              <div className="text-center py-10">
                <Download className="w-8 h-8 mx-auto mb-3 text-muted-foreground/20" />
                <p className="text-muted-foreground/60 text-xs">
                  No transfers yet
                </p>
              </div>
            ) : (
              activeDownloads
                .slice()
                .reverse()
                .map((d) => (
                  <div
                    key={d.taskId}
                    className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04] space-y-2.5"
                  >
                    <div className="flex items-start gap-2">
                      {/* Status icon */}
                      <div className="mt-0.5 shrink-0">
                        {d.isError ? (
                          <AlertCircle className="w-4 h-4 text-destructive" />
                        ) : d.isComplete ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Loader2 className="w-4 h-4 text-primary animate-spin" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span
                          className="text-sm font-medium truncate block"
                          title={d.title}
                        >
                          {d.title}
                        </span>
                        <span
                          className={`text-[11px] ${d.isError ? "text-destructive/80" : d.isComplete ? "text-emerald-400/80" : "text-muted-foreground/70"}`}
                        >
                          {d.statusText}
                        </span>
                      </div>
                      {!d.isComplete && !d.isError && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={() => handleCancelDownload(d.taskId)}
                          title="Cancel download"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {d.isError && d.item && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0"
                          onClick={() => handleDownload(d.item, d.itemType)}
                          title="Retry download"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0 tabular-nums">
                        {d.progress}%
                      </span>
                    </div>
                    {!d.isComplete && (
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                          style={{ width: `${d.progress}%` }}
                        />
                      </div>
                    )}
                    {d.isComplete && !d.isError && (
                      <div className="h-1 rounded-full bg-emerald-400/30 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400 w-full" />
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SETTINGS DIALOG (Extracted Component)
════════════════════════════════════════════════════════════════════════ */
function SettingsDialog({
  settings,
  onSettingChange,
  userInfo,
  onLogout,
}: {
  settings: {
    quality_tier: string;
    allow_dolby_atmos: boolean;
    r2_enabled?: boolean;
    r2_account_id?: string;
    r2_access_key_id?: string;
    r2_secret_access_key?: string;
    r2_bucket_name?: string;
    r2_public_domain?: string;
    r2_configured?: boolean;
  };
  onSettingChange: (key: string, value: any) => void;
  userInfo?: { username?: string; user_id?: string; country?: string } | null;
  onLogout?: () => void;
}) {
  return (
    <DialogContent className="max-w-md glass-strong border border-white/[0.08] text-foreground rounded-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-lg">Settings</DialogTitle>
      </DialogHeader>
      <div className="space-y-5 pt-2">
        {/* Account Section */}
        {userInfo && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Account
            </Label>
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <User className="w-4.5 h-4.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground">
                    {userInfo.username || "Tidal Account"}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 truncate">
                    {userInfo.user_id ? `ID: ${userInfo.user_id}` : "Connected"}
                    {userInfo.country ? ` · ${userInfo.country}` : ""}
                  </p>
                </div>
              </div>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 border border-destructive/20 transition-colors shrink-0 ml-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Logout
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quality */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            Audio Quality
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "LOW", label: "Low", desc: "96 kbps" },
              { value: "HIGH", label: "High", desc: "320 kbps" },
              { value: "LOSSLESS", label: "Lossless", desc: "16-bit FLAC" },
              { value: "MAX", label: "Hi-Res", desc: "24-bit FLAC" },
            ].map((tier) => (
              <button
                key={tier.value}
                onClick={() => onSettingChange("quality_tier", tier.value)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  settings.quality_tier === tier.value
                    ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20"
                    : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <span className="text-sm font-medium block">{tier.label}</span>
                <span className="text-[11px] text-muted-foreground/60">
                  {tier.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Dolby toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
          <div>
            <Label className="text-sm font-medium cursor-pointer">
              Dolby Atmos
            </Label>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Download Atmos mixes when available
            </p>
          </div>
          <button
            onClick={() =>
              onSettingChange("allow_dolby_atmos", !settings.allow_dolby_atmos)
            }
            className={`w-11 h-6 rounded-full relative transition-colors ${
              settings.allow_dolby_atmos ? "bg-primary" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                settings.allow_dolby_atmos ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Cloudflare R2 Bucket Section */}
        <div className="space-y-3 pt-2 border-t border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                Cloudflare R2 Bucket Dump
                {settings.r2_configured && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                    Active
                  </span>
                )}
              </Label>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                Temporary dump storage for large downloads
              </p>
            </div>
            <button
              onClick={() => onSettingChange("r2_enabled", !settings.r2_enabled)}
              className={`w-11 h-6 rounded-full relative transition-colors ${
                settings.r2_enabled ? "bg-primary" : "bg-white/10"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                  settings.r2_enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {settings.r2_enabled && (
            <div className="space-y-2.5 pt-1">
              <div>
                <Label className="text-[11px] text-muted-foreground/80 mb-1 block">Account ID</Label>
                <Input
                  type="text"
                  placeholder="e.g. a1b2c3d4e5f6..."
                  value={settings.r2_account_id || ""}
                  onChange={(e) => onSettingChange("r2_account_id", e.target.value)}
                  className="h-8 text-xs bg-white/[0.03] border-white/[0.08]"
                />
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground/80 mb-1 block">Access Key ID</Label>
                <Input
                  type="text"
                  placeholder="R2 Access Key"
                  value={settings.r2_access_key_id || ""}
                  onChange={(e) => onSettingChange("r2_access_key_id", e.target.value)}
                  className="h-8 text-xs bg-white/[0.03] border-white/[0.08]"
                />
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground/80 mb-1 block">Secret Access Key</Label>
                <Input
                  type="password"
                  placeholder="R2 Secret Key"
                  value={settings.r2_secret_access_key || ""}
                  onChange={(e) => onSettingChange("r2_secret_access_key", e.target.value)}
                  className="h-8 text-xs bg-white/[0.03] border-white/[0.08]"
                />
              </div>

              <div>
                <Label className="text-[11px] text-muted-foreground/80 mb-1 block">Bucket Name</Label>
                <Input
                  type="text"
                  placeholder="e.g. tdl-temp-dump"
                  value={settings.r2_bucket_name || ""}
                  onChange={(e) => onSettingChange("r2_bucket_name", e.target.value)}
                  className="h-8 text-xs bg-white/[0.03] border-white/[0.08]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TRACK SELECTION DIALOG (For Albums & Playlists)
════════════════════════════════════════════════════════════════════════ */
function TrackSelectionDialog({
  collection,
  tracks,
  isLoading,
  selectedTrackIds,
  onToggleSelectTrack,
  onToggleSelectAll,
  onDownloadSelected,
  onSingleDownload,
  onClose,
}: {
  collection: { type: "albums" | "playlists"; item: any } | null;
  tracks: any[];
  isLoading: boolean;
  selectedTrackIds: string[];
  onToggleSelectTrack: (id: string) => void;
  onToggleSelectAll: () => void;
  onDownloadSelected: () => void;
  onSingleDownload: (track: any) => void;
  onClose: () => void;
}) {
  if (!collection) return null;
  const isAllSelected = tracks.length > 0 && selectedTrackIds.length === tracks.length;

  return (
    <Dialog open={!!collection} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-w-[calc(100%-1.5rem)] w-full max-h-[85vh] glass-strong border border-white/[0.08] text-foreground rounded-2xl flex flex-col p-4 sm:p-6 overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between gap-3 pb-3 border-b border-white/[0.06] shrink-0 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-xl bg-white/[0.04] overflow-hidden shrink-0">
              {getCoverUrl(collection.item, collection.type) ? (
                <img
                  src={getCoverUrl(collection.item, collection.type)!}
                  alt={collection.item.title || collection.item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-primary/10">
                  <Music className="w-6 h-6 text-primary" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-semibold truncate pr-6">
                {collection.item.title || collection.item.name}
              </DialogTitle>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {getArtistText(collection.item, collection.type)} · {tracks.length} tracks
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        {!isLoading && tracks.length > 0 && (
          <div className="flex items-center justify-between py-2 border-b border-white/[0.04] shrink-0 text-xs gap-2">
            <button
              onClick={onToggleSelectAll}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-medium shrink-0"
            >
              {isAllSelected ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground/60" />
              )}
              {isAllSelected ? "Deselect All" : "Select All"} ({selectedTrackIds.length}/{tracks.length})
            </button>
            <Button
              size="sm"
              onClick={onDownloadSelected}
              disabled={selectedTrackIds.length === 0}
              className="h-8 rounded-lg bg-primary hover:brightness-110 text-xs font-semibold px-3 gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download Selected</span>
              <span>({selectedTrackIds.length})</span>
            </Button>
          </div>
        )}

        {/* Track List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 py-2 pr-1 smooth-scroll min-w-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-xs">Fetching tracks from Tidal...</p>
            </div>
          ) : tracks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground/60 text-xs">
              No tracks found in this collection.
            </div>
          ) : (
            tracks.map((track, idx) => {
              const isSelected = selectedTrackIds.includes(String(track.id));
              const trackNum = track.trackNumber || idx + 1;
              const durSec = track.duration;
              const durText = durSec
                ? `${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, "0")}`
                : "";

              return (
                <div
                  key={track.id || idx}
                  onClick={() => onToggleSelectTrack(String(track.id))}
                  className={`flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer min-w-0 ${
                    isSelected
                      ? "bg-primary/10 border-primary/30"
                      : "bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.04]"
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelectTrack(String(track.id));
                    }}
                    className="shrink-0 text-muted-foreground"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground/40" />
                    )}
                  </button>
                  <span className="text-xs font-mono text-muted-foreground/50 w-5 shrink-0 text-right">
                    {trackNum}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium truncate text-foreground">
                      {track.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 truncate">
                      {track.artist?.name || track.artists?.map((a: any) => a.name).join(", ") || "Artist"}
                    </p>
                  </div>
                  {durText && (
                    <span className="text-[11px] font-mono text-muted-foreground/50 shrink-0 hidden sm:inline">
                      {durText}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 rounded-lg shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSingleDownload(track);
                    }}
                    title="Download track"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
