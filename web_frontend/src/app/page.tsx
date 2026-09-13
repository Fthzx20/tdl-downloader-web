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
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [showDownloads, setShowDownloads] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

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
          const stored = localStorage.getItem("tdl_auth");
          if (stored) setIsAuthenticated(true);
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

            // Extract live download speed
            let liveSpeed = "";
            for (const t of trackList) {
              if (t.status && (t.status.includes("MB/s") || t.status.includes("KB/s"))) {
                const match = t.status.match(/\(([\d.]+\s*(?:MB|KB)\/s)\)/);
                if (match) {
                  liveSpeed = match[1];
                  break;
                }
              }
            }

            const pct = totalTracks > 0 ? Math.round((finished / totalTracks) * 100) : 0;
            const statusMsg =
              totalTracks > 1
                ? `Downloading · ${finished}/${totalTracks} tracks`
                : liveSpeed
                  ? `Downloading from Tidal`
                  : "Downloading from Tidal...";

            updateDownload(d.taskId, {
              statusText: statusMsg,
              speedText: liveSpeed,
              progress: pct > 0 ? pct : d.progress,
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

  const handleDownload = async (item: any) => {
    const downloadType =
      type === "tracks" ? "track" : type === "albums" ? "album" : "playlist";
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
      },
    ]);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed");

      const contentLength = response.headers.get("Content-Length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Stream unavailable");

      const chunks: BlobPart[] = [];
      let startTime = Date.now();
      let lastLoaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;

        const now = Date.now();
        if (now - startTime > 400) {
          const speed = ((loaded - lastLoaded) / (now - startTime)) * 1000;
          const speedMB = (speed / 1024 / 1024).toFixed(1);
          const loadedMB = (loaded / 1024 / 1024).toFixed(1);
          const percent = total ? Math.round((loaded / total) * 100) : 50;
          updateDownload(taskId, {
            progress: percent,
            statusText: `${loadedMB} MB · ${speedMB} MB/s`,
          });
          startTime = now;
          lastLoaded = loaded;
        }
      }

      updateDownload(taskId, { progress: 100, statusText: "Saving..." });

      const blob = new Blob(chunks);
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const cd = response.headers.get("content-disposition");
      let filename = `${itemTitle}.${downloadType === "track" ? "flac" : "zip"}`;
      if (cd && cd.includes("filename=")) {
        filename = cd.split("filename=")[1].replace(/"/g, "");
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objectUrl);

      updateDownload(taskId, {
        statusText: "Complete",
        isComplete: true,
        progress: 100,
      });
      toast.success(`Downloaded "${itemTitle}"`);
    } catch {
      updateDownload(taskId, {
        statusText: "Failed",
        isError: true,
        isComplete: true,
      });
      toast.error(`Failed to download "${itemTitle}"`);
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
              <TabsList className="grid grid-cols-4 w-full max-w-md mx-auto bg-white/[0.04] p-1 rounded-xl h-auto border border-white/[0.06]">
                <TabsTrigger
                  value="tracks"
                  className="rounded-lg px-1 sm:px-3 py-2 text-[11px] sm:text-xs md:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary flex items-center justify-center min-w-0"
                >
                  <Music className="w-3.5 h-3.5 mr-1 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Tracks</span>
                </TabsTrigger>
                <TabsTrigger
                  value="albums"
                  className="rounded-lg px-1 sm:px-3 py-2 text-[11px] sm:text-xs md:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary flex items-center justify-center min-w-0"
                >
                  <Disc className="w-3.5 h-3.5 mr-1 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Albums</span>
                </TabsTrigger>
                <TabsTrigger
                  value="playlists"
                  className="rounded-lg px-1 sm:px-3 py-2 text-[11px] sm:text-xs md:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary flex items-center justify-center min-w-0"
                >
                  <ListMusic className="w-3.5 h-3.5 mr-1 shrink-0 hidden sm:inline-block" />
                  <span className="truncate">Playlists</span>
                </TabsTrigger>
                <TabsTrigger
                  value="artists"
                  className="rounded-lg px-1 sm:px-3 py-2 text-[11px] sm:text-xs md:text-sm data-[state=active]:bg-primary/15 data-[state=active]:text-primary flex items-center justify-center min-w-0"
                >
                  <User className="w-3.5 h-3.5 mr-1 shrink-0 hidden sm:inline-block" />
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

                        {/* Download button — visible on mobile always, on desktop on hover */}
                        {type !== "artists" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-9 h-9 md:w-10 md:h-10 rounded-xl shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 md:opacity-0 md:group-hover:opacity-100 transition-all active:scale-90"
                            onClick={() => handleDownload(item)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
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
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 rounded-full hover:bg-white/10"
              onClick={() => setShowDownloads(false)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
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
  settings: { quality_tier: string; allow_dolby_atmos: boolean };
  onSettingChange: (key: string, value: any) => void;
  userInfo?: { username?: string; user_id?: string; country?: string } | null;
  onLogout?: () => void;
}) {
  return (
    <DialogContent className="max-w-sm glass-strong border border-white/[0.08] text-foreground rounded-2xl">
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
      </div>
    </DialogContent>
  );
}
