import re
import os
import shutil
import asyncio
import zipfile
import time
import gc
import tempfile
import urllib.parse
import aiohttp
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tidal_rip.config import Config
from tidal_rip.api import TidalAPI
from tidal_rip.downloader import DownloadManager, sanitize_filename
from tidal_rip.r2_storage import R2StorageManager

app = FastAPI(title="Tidal Rip Web API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
config = Config()
api = TidalAPI(config)
downloader = DownloadManager(api, config)
r2_storage = R2StorageManager(config)

# Make sure temp directory exists for zipping (portable across OS and containers)
TEMP_DIR = os.environ.get("TEMP_DIR", os.path.join(tempfile.gettempdir(), "Tidal_Temp_Zips"))
try:
    os.makedirs(TEMP_DIR, exist_ok=True)
except Exception:
    TEMP_DIR = tempfile.gettempdir()

DOWNLOAD_SEM = asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_DOWNLOADS", "2")))


def require_auth():
    """Raises 401 if not authenticated."""
    if not config.access_token:
        raise HTTPException(status_code=401, detail="Not authenticated. Please log in to Tidal first.")


def parse_tidal_url(query: str):
    """Parses track, album, playlist, or artist links from Tidal, including raw playlist UUIDs."""
    if not query:
        return None, None
    # Strip query parameters (e.g. ?utm_source=share) and hash fragments
    query_clean = query.split("?")[0].split("#")[0].strip()
    
    # Check for raw UUID (custom playlist ID)
    uuid_pattern = r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
    uuid_match = re.search(uuid_pattern, query_clean)
    if uuid_match:
        return "playlist", uuid_match.group(1)
        
    patterns = {
        "track": r"tidal\.com/(?:[a-z]+/)?(?:browse/)?track/(\d+)",
        "album": r"tidal\.com/(?:[a-z]+/)?(?:browse/)?album/(\d+)",
        "playlist": r"tidal\.com/(?:[a-z]+/)?(?:browse/)?playlist/([a-zA-Z0-9-]+)",
        "artist": r"tidal\.com/(?:[a-z]+/)?(?:browse/)?artist/(\d+)"
    }
    for item_type, pattern in patterns.items():
        match = re.search(pattern, query_clean)
        if match:
            return item_type, match.group(1)
    return None, None


async def resolve_external_link(url: str):
    """Resolves Spotify, Deezer, Apple Music, or YouTube Music URLs to a search query tuple (type, search_query, platform_name)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    url_clean = url.split("?")[0].split("#")[0].strip()
    
    # 1. Deezer
    if "deezer.com" in url_clean or "deezer.page.link" in url_clean:
        track_match = re.search(r"deezer\.com/(?:[a-z]+/)?track/(\d+)", url_clean)
        album_match = re.search(r"deezer\.com/(?:[a-z]+/)?album/(\d+)", url_clean)
        async with aiohttp.ClientSession(headers=headers) as session:
            try:
                if track_match:
                    tid = track_match.group(1)
                    async with session.get(f"https://api.deezer.com/track/{tid}") as resp:
                        if resp.status == 200:
                            d = await resp.json()
                            title = d.get("title", "")
                            artist = d.get("artist", {}).get("name", "")
                            isrc = d.get("isrc", "")
                            query = isrc if isrc else f"{title} {artist}".strip()
                            return "track", query, "Deezer"
                elif album_match:
                    aid = album_match.group(1)
                    async with session.get(f"https://api.deezer.com/album/{aid}") as resp:
                        if resp.status == 200:
                            d = await resp.json()
                            title = d.get("title", "")
                            artist = d.get("artist", {}).get("name", "")
                            return "album", f"{title} {artist}".strip(), "Deezer"
            except Exception as e:
                print(f"Deezer resolve error: {e}")

    # 2. Spotify
    elif "spotify.com" in url_clean or "spoti.fi" in url_clean:
        is_album = "/album/" in url_clean
        embed_url = url_clean.replace("open.spotify.com/", "open.spotify.com/embed/")
        async with aiohttp.ClientSession(headers=headers) as session:
            try:
                async with session.get(embed_url) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">([^<]+)</script>', text)
                        if match:
                            import json
                            data = json.loads(match.group(1))
                            entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                            name = entity.get("name", "")
                            artists = [a.get("name") for a in entity.get("artists", []) if a.get("name")]
                            artist_str = " ".join(artists)
                            item_type = "album" if is_album else "track"
                            return item_type, f"{name} {artist_str}".strip(), "Spotify"
            except Exception as e:
                print(f"Spotify embed parse error: {e}")

    # 3. YouTube / YouTube Music
    elif "youtube.com" in url_clean or "youtu.be" in url_clean:
        encoded = urllib.parse.quote(url, safe="")
        ep = f"https://www.youtube.com/oembed?url={encoded}&format=json"
        async with aiohttp.ClientSession(headers=headers) as session:
            try:
                async with session.get(ep) as resp:
                    if resp.status == 200:
                        d = await resp.json()
                        title = d.get("title", "")
                        author = d.get("author_name", "")
                        clean_title = re.sub(r"[\(\[\{].*?[\)\]\}]", "", title).strip()
                        clean_title = re.sub(r"(?i)\b(official video|lyric video|audio|remastered|hd|4k)\b", "", clean_title).strip()
                        if author and author.lower() not in clean_title.lower():
                            query_str = f"{clean_title} {author}".strip()
                        else:
                            query_str = clean_title
                        return "track", query_str, "YouTube Music"
            except Exception as e:
                print(f"YouTube oEmbed error: {e}")

    # 4. Apple Music
    elif "apple.com" in url_clean:
        is_album = "/album/" in url_clean and "?i=" not in url
        slug_match = re.search(r"apple\.com/(?:[a-z]+/)?album/(?:[^/]+/)?([^/?#]+)", url_clean)
        if slug_match:
            slug = slug_match.group(1).replace("-", " ")
            slug = re.sub(r"\d+$", "", slug).strip()  # Strip trailing track/album numeric IDs if matched
            item_type = "album" if is_album else "track"
            return item_type, slug, "Apple Music"

    return None, None, None


def trim_memory():
    """Forces garbage collection and releases glibc arena memory back to OS (essential for 256MB container)."""
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def cleanup_file(path: str):
    """Background task to remove a file/zip after sending it."""
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Failed to cleanup {path}: {e}")
    finally:
        trim_memory()


def cleanup_dir(path: str):
    """Background task to remove a directory after sending its zip."""
    try:
        if os.path.exists(path):
            shutil.rmtree(path)
    except Exception as e:
        print(f"Failed to cleanup {path}: {e}")
    finally:
        trim_memory()


def purge_stale_temp_cache(max_age_seconds: int = 900):
    """Purges lingering temporary files (.tmp, .zip archives, empty directories) older than max_age_seconds."""
    try:
        now = time.time()
        # Clean TEMP_DIR (zip archives)
        if os.path.exists(TEMP_DIR):
            for fname in os.listdir(TEMP_DIR):
                fpath = os.path.join(TEMP_DIR, fname)
                try:
                    if os.path.isfile(fpath) and (now - os.path.getmtime(fpath) > max_age_seconds):
                        os.remove(fpath)
                    elif os.path.isdir(fpath) and (now - os.path.getmtime(fpath) > max_age_seconds):
                        shutil.rmtree(fpath)
                except Exception:
                    pass
        # Clean lingering .tmp files in download directory
        dl_dir = config.download_directory
        if os.path.exists(dl_dir):
            for root_dir, dirs, files in os.walk(dl_dir):
                for file in files:
                    if file.endswith(".tmp"):
                        fpath = os.path.join(root_dir, file)
                        try:
                            if now - os.path.getmtime(fpath) > max_age_seconds:
                                os.remove(fpath)
                        except Exception:
                            pass
        trim_memory()
    except Exception as e:
        print(f"Error purging stale cache: {e}")


async def _periodic_cleanup_loop():
    """Periodically cleans stale active/completed tasks, purges old temporary files, and trims RAM."""
    while True:
        try:
            await asyncio.sleep(60)
            now = time.time()
            # Prune completed tasks older than 2 minutes
            stale_completed = [tid for tid, ts in list(completed_tasks.items()) if now - ts > 120]
            for tid in stale_completed:
                completed_tasks.pop(tid, None)
                active_tasks.pop(tid, None)

            # Prune active tasks inactive for > 10 minutes (600s)
            expired = [
                tid for tid, tracks in list(active_tasks.items())
                if tracks and all(now - t.get("time", 0) > 600 for t in tracks.values())
            ]
            for tid in expired:
                active_tasks.pop(tid, None)

            # Purge temp cache files older than 15 minutes
            purge_stale_temp_cache(max_age_seconds=900)
            trim_memory()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Periodic background cleanup error: {e}")


@app.on_event("startup")
async def startup_event():
    # Purge any old leftover temp files on startup
    purge_stale_temp_cache(max_age_seconds=300)
    # Start periodic background cleanup loop
    asyncio.create_task(_periodic_cleanup_loop())
    # If token exists, verify session
    if config.access_token:
        try:
            await api.fetch_session_info()
            print("Session verified on startup.")
        except Exception:
            pass


@app.on_event("shutdown")
async def shutdown_event():
    """Gracefully closes aiohttp connections during server reload/shutdown."""
    try:
        await api.close()
    except Exception:
        pass


@app.post("/system/clear_cache")
def clear_cache_endpoint():
    """Manually purges temporary files, zip archives, and cached temp files."""
    purge_stale_temp_cache(max_age_seconds=0) # Clear all immediately
    trim_memory()
    return {"status": "success", "message": "Server temporary cache cleared."}


@app.get("/")
def root():
    return {"status": "ok", "message": "Tidal Rip API is running."}


@app.get("/health")
def health():
    return {"status": "ok", "healthy": True}


@app.get("/auth/status")
async def get_auth_status():
    """Returns authentication status and current logged in user info."""
    is_logged_in = bool(config.access_token)
    if is_logged_in:
        try:
            # Auto-refresh if token is close to expiration (< 5 mins)
            if config.refresh_token and (config.token_expiry - time.time() < 300):
                await api.refresh_token()
            # Fetch username profile if missing
            if not config.user_name and config.user_id:
                try:
                    user_info = await api._api_request("GET", f"users/{config.user_id}")
                    if user_info:
                        uname = user_info.get("username") or user_info.get("email") or user_info.get("firstName")
                        if uname:
                            config.user_name = str(uname)
                            config.save()
                except Exception:
                    pass
        except Exception as e:
            print(f"Auto refresh on status check failed: {e}")
            
    display_name = config.user_name or (f"User #{config.user_id}" if config.user_id else "Tidal User")
    
    return {
        "authenticated": bool(config.access_token),
        "user_id": config.user_id,
        "username": display_name,
        "country": api.country_code
    }


@app.api_route("/auth/logout", methods=["GET", "POST"])
def logout():
    """Logs out the user and clears stored session tokens."""
    config.clear_session()
    return {"status": "success", "message": "Logged out successfully"}


@app.get("/auth/login_url")
def get_login_url():
    """Returns the PKCE login URL."""
    url = api.get_pkce_login_url()
    return {"login_url": url}


class AuthCodeRequest(BaseModel):
    code: str

@app.post("/auth/exchange")
async def exchange_code(req: AuthCodeRequest):
    """Exchanges the PKCE auth code for a token."""
    try:
        await api.exchange_pkce_code(req.code)
        return {"status": "success", "user_id": config.user_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/search")
async def search(query: str, type: str = "tracks"):
    """Search Tidal catalog or resolve Tidal link/UUID."""
    require_auth()
    try:
        query_str = query.strip()
        if not query_str:
            return {"items": []}
            
        url_type, url_id = parse_tidal_url(query_str)
        
        if url_type:
            if url_type == "track":
                track = await api.get_track(url_id)
                return {"items": [track], "resolved_type": "tracks"}
            elif url_type == "album":
                album = await api.get_album(url_id)
                return {"items": [album], "resolved_type": "albums"}
            elif url_type == "playlist":
                playlist = await api.get_playlist(url_id)
                return {"items": [playlist], "resolved_type": "playlists"}
            elif url_type == "artist":
                albums_resp = await api.get_artist_albums(url_id)
                return {"items": albums_resp.get("items", []), "resolved_type": "albums"}

        # Check for cross-platform links (Spotify, Deezer, Apple Music, YouTube Music)
        ext_type, ext_query, platform_name = await resolve_external_link(query_str)
        effective_query = ext_query if ext_query else query_str
        target_type = (ext_type + "s") if ext_type else type

        # Standard keyword search query using effective query
        res = await api.search(effective_query, limit=50)
        
        # Extract category data
        category_data = res.get(target_type, {}) if isinstance(res.get(target_type), dict) else {}
        items = list(category_data.get("items", []))
        
        # Check topHit for exact match prioritization
        top_hit = res.get("topHit")
        if top_hit and isinstance(top_hit, dict):
            top_hit_item = top_hit.get("value")
            top_hit_type = str(top_hit.get("type", "")).lower()
            
            # Match topHit type with request type
            if top_hit_item and isinstance(top_hit_item, dict) and (top_hit_type == target_type or top_hit_type == target_type.rstrip("s")):
                top_hit_id = top_hit_item.get("id")
                if top_hit_id is not None:
                    items = [item for item in items if item.get("id") != top_hit_id]
                    items.insert(0, top_hit_item)
            
        response_payload = {"items": items}
        if ext_query:
            response_payload["resolved_type"] = target_type
            response_payload["converted_from"] = platform_name
            response_payload["original_query"] = query_str
            
        return response_payload
    except HTTPException:
        raise
    except Exception as e:
        print(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


active_tasks = {}
completed_tasks = {}  # task_id -> completion timestamp
ws_subscribers: dict[str, set[WebSocket]] = {}

def mark_task_complete(task_id: str):
    """Mark a task as complete so frontend polling and WebSockets can detect it."""
    if task_id:
        completed_tasks[task_id] = time.time()
        # Broadcast completion to WebSocket subscribers
        subs = ws_subscribers.pop(task_id, None)
        if subs:
            msg = {"status": "complete", "tracks": active_tasks.get(task_id, {})}
            for ws in subs:
                try:
                    asyncio.create_task(ws.send_json(msg))
                except Exception:
                    pass
        # Clean up old completed tasks (older than 2 minutes) to prevent memory leak
        now = time.time()
        stale = [tid for tid, ts in completed_tasks.items() if now - ts > 120]
        for tid in stale:
            completed_tasks.pop(tid, None)
            active_tasks.pop(tid, None)

def create_progress_callback(task_id: str, track_id: str):
    async def cb(downloaded, total, status):
        if not task_id: return
        if task_id not in active_tasks:
            active_tasks[task_id] = {}
        track_info = {
            "downloaded": downloaded,
            "total": total,
            "status": status,
            "time": time.time()
        }
        active_tasks[task_id][track_id] = track_info

        # Real-time WebSocket push
        subs = ws_subscribers.get(task_id)
        if subs:
            msg = {
                "status": "active",
                "tracks": active_tasks[task_id],
                "track_id": track_id,
                "update": track_info
            }
            dead = set()
            for ws in list(subs):
                try:
                    await ws.send_json(msg)
                except Exception:
                    dead.add(ws)
            if dead:
                subs.difference_update(dead)
    return cb

@app.websocket("/ws/progress/{task_id}")
async def ws_progress_endpoint(websocket: WebSocket, task_id: str):
    """Real-time WebSocket endpoint for tracking download progress of a task."""
    await websocket.accept()
    if task_id not in ws_subscribers:
        ws_subscribers[task_id] = set()
    ws_subscribers[task_id].add(websocket)

    try:
        if task_id in completed_tasks:
            await websocket.send_json({"status": "complete", "tracks": active_tasks.get(task_id, {})})
        elif task_id in active_tasks:
            await websocket.send_json({"status": "active", "tracks": active_tasks[task_id]})
        else:
            await websocket.send_json({"status": "waiting", "tracks": {}})

        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if task_id in ws_subscribers:
            ws_subscribers[task_id].discard(websocket)
            if not ws_subscribers[task_id]:
                ws_subscribers.pop(task_id, None)

@app.get("/progress/{task_id}")
def get_progress(task_id: str):
    now = time.time()
    # Prune stale completed_tasks older than 2 minutes
    stale_completed = [tid for tid, ts in list(completed_tasks.items()) if now - ts > 120]
    for tid in stale_completed:
        completed_tasks.pop(tid, None)
        active_tasks.pop(tid, None)

    # Clean up old tasks inactive for > 10 minutes (600s)
    expired = [
        tid for tid, tracks in list(active_tasks.items())
        if tracks and all(now - t.get("time", 0) > 600 for t in tracks.values())
    ]
    for tid in expired:
        active_tasks.pop(tid, None)

    # Check if task was explicitly marked as complete
    if task_id in completed_tasks:
        tracks_data = active_tasks.get(task_id, {})
        return {"status": "complete", "tracks": tracks_data}

    if task_id not in active_tasks:
        return {"status": "not_found", "tracks": {}}
    
    return {"status": "active", "tracks": active_tasks[task_id]}

def cleanup_empty_dir(path: str):
    """Background task: removes a directory only if it's empty after file cleanup."""
    try:
        if path and os.path.exists(path) and os.path.isdir(path):
            # Only remove if empty (no other tracks being processed)
            if not os.listdir(path):
                os.rmdir(path)
                # Also try to clean parent if empty (Artist folder)
                parent = os.path.dirname(path)
                if parent and os.path.exists(parent) and os.path.isdir(parent) and not os.listdir(parent):
                    os.rmdir(parent)
    except Exception:
        pass


def _create_zip_archive(zip_path: str, source_dir: str):
    """Creates a ZIP archive from a directory (runs in thread pool)."""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zipf:
        for root_dir, dirs, files in os.walk(source_dir):
            for file in files:
                file_path = os.path.join(root_dir, file)
                arcname = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname)


async def serve_or_upload_r2(local_path: str, background_tasks: BackgroundTasks, cleanup_paths: list = None):
    """If Cloudflare R2 is configured, uploads file to R2 and returns 307 redirect. Otherwise returns FileResponse with background cleanup."""
    if r2_storage.is_configured():
        try:
            r2_url = await r2_storage.upload_and_get_url(local_path)
            if cleanup_paths:
                for cp in cleanup_paths:
                    if os.path.isdir(cp):
                        cleanup_dir(cp)
                    elif os.path.exists(cp):
                        cleanup_file(cp)
            return RedirectResponse(url=r2_url, status_code=307)
        except Exception as e:
            print(f"R2 Upload failed, falling back to local serve: {e}")

    filename = os.path.basename(local_path)
    parent_dir = os.path.dirname(local_path)

    background_tasks.add_task(cleanup_file, local_path)
    if cleanup_paths:
        for cp in cleanup_paths:
            if os.path.exists(cp):
                if os.path.isdir(cp):
                    background_tasks.add_task(cleanup_dir, cp)
                else:
                    background_tasks.add_task(cleanup_file, cp)
    background_tasks.add_task(cleanup_empty_dir, parent_dir)

    media_type = 'application/zip' if filename.endswith('.zip') else 'application/octet-stream'
    return FileResponse(local_path, media_type=media_type, filename=filename)


@app.get("/download/track/{track_id}")
async def download_track(track_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads a single track and returns the audio file directly or via R2 redirect."""
    require_auth()
    try:
        cb = create_progress_callback(task_id, track_id) if task_id else None
        final_path = await asyncio.wait_for(
            downloader.download_track(track_id, progress_callback=cb),
            timeout=300
        )
        if not final_path or not os.path.exists(final_path):
            raise Exception("Download failed or skipped.")
            
        lrc_path = os.path.splitext(final_path)[0] + ".lrc"
        cleanup_paths = [lrc_path] if os.path.exists(lrc_path) else []
        
        mark_task_complete(task_id)
        return await serve_or_upload_r2(final_path, background_tasks, cleanup_paths=cleanup_paths)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/download/album/{album_id}")
async def download_album(album_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads an album, zips it, and returns the zip file or R2 redirect."""
    require_auth()
    try:
        # Free disk space before a large download operation
        purge_stale_temp_cache(max_age_seconds=60)
        
        album = await api.get_album(album_id)
        safe_album = sanitize_filename(album.get("title", "Album"))
        
        tracks_resp = await api.get_album_tracks(album_id)
        items = tracks_resp.get("items", [])
        
        if not items:
            raise Exception("No tracks found on this album.")
            
        sem = DOWNLOAD_SEM
        async def sem_download(tid, parent, cb):
            async with sem:
                try:
                    return await asyncio.wait_for(
                        downloader.download_track(tid, parent_folder=parent, progress_callback=cb),
                        timeout=300
                    )
                except asyncio.TimeoutError:
                    print(f"Track {tid} download timed out after 300s")
                    if cb:
                        await cb(0, 1, "Timed out")
                    return None

        tasks = []
        for item in items:
            track_info = item.get("item") if isinstance(item, dict) and "item" in item else item
            if track_info and isinstance(track_info, dict) and "id" in track_info:
                if track_info.get("type") in ["VIDEO", "Video", "MUSIC_VIDEO"]:
                    continue
                if track_info.get("streamReady") is False or track_info.get("allowStreaming") is False:
                    continue
                tid = track_info["id"]
                cb = create_progress_callback(task_id, str(tid)) if task_id else None
                tasks.append(sem_download(tid, safe_album, cb))
            
        downloaded_paths = await asyncio.gather(*tasks, return_exceptions=True)
        
        valid_paths = [p for p in downloaded_paths if isinstance(p, str) and os.path.exists(p)]
        if not valid_paths:
            raise Exception("All track downloads failed.")
            
        album_dir = os.path.dirname(valid_paths[0])
        
        # Update progress to indicate zipping stage
        if task_id and task_id in active_tasks:
            for tid_key in list(active_tasks[task_id].keys()):
                active_tasks[task_id][tid_key]["status"] = "Creating ZIP archive..."

        uid_tag = task_id if task_id else str(int(time.time() * 1000))
        zip_path = os.path.join(TEMP_DIR, f"{safe_album}_{uid_tag}.zip")
        await asyncio.to_thread(_create_zip_archive, zip_path, album_dir)
                    
        mark_task_complete(task_id)
        return await serve_or_upload_r2(zip_path, background_tasks, cleanup_paths=[album_dir])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/playlist/{playlist_id}")
async def download_playlist(playlist_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads a playlist, zips it, and returns the zip file or R2 redirect."""
    require_auth()
    try:
        # Free disk space before a large download operation
        purge_stale_temp_cache(max_age_seconds=60)
        
        playlist = await api.get_playlist(playlist_id)
        safe_playlist = sanitize_filename(playlist.get("title", "Playlist"))
        
        items = await api.get_playlist_tracks(playlist_id)
        if not items:
            raise Exception("No tracks found in this playlist.")
            
        sem = DOWNLOAD_SEM
        async def sem_download(tid, parent, cb):
            async with sem:
                try:
                    return await asyncio.wait_for(
                        downloader.download_track(tid, parent_folder=parent, progress_callback=cb),
                        timeout=300
                    )
                except asyncio.TimeoutError:
                    print(f"Track {tid} download timed out after 300s")
                    if cb:
                        await cb(0, 1, "Timed out")
                    return None

        tasks = []
        for item in items:
            track_info = item.get("item") if isinstance(item, dict) and "item" in item else item
            if track_info and isinstance(track_info, dict) and "id" in track_info:
                if track_info.get("type") in ["VIDEO", "Video", "MUSIC_VIDEO"]:
                    continue
                if track_info.get("streamReady") is False or track_info.get("allowStreaming") is False:
                    continue
                tid = track_info["id"]
                cb = create_progress_callback(task_id, str(tid)) if task_id else None
                tasks.append(sem_download(tid, safe_playlist, cb))
                
        downloaded_paths = await asyncio.gather(*tasks, return_exceptions=True)
        
        valid_paths = [p for p in downloaded_paths if isinstance(p, str) and os.path.exists(p)]
        if not valid_paths:
            raise Exception("All track downloads failed.")
            
        playlist_dir = os.path.dirname(valid_paths[0])
        
        # Update progress to indicate zipping stage
        if task_id and task_id in active_tasks:
            for tid_key in list(active_tasks[task_id].keys()):
                active_tasks[task_id][tid_key]["status"] = "Creating ZIP archive..."

        uid_tag = task_id if task_id else str(int(time.time() * 1000))
        zip_path = os.path.join(TEMP_DIR, f"{safe_playlist}_{uid_tag}.zip")
        await asyncio.to_thread(_create_zip_archive, zip_path, playlist_dir)
                    
        mark_task_complete(task_id)
        return await serve_or_upload_r2(zip_path, background_tasks, cleanup_paths=[playlist_dir])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/album/{album_id}/tracks")
async def get_album_tracks_endpoint(album_id: str):
    """Gets tracks listing for an album."""
    require_auth()
    try:
        res = await api.get_album_tracks(album_id)
        return {"items": res.get("items", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/playlist/{playlist_id}/tracks")
async def get_playlist_tracks_endpoint(playlist_id: str):
    """Gets tracks listing for a playlist."""
    require_auth()
    try:
        items = await api.get_playlist_tracks(playlist_id)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


_preview_cache: dict[str, tuple[bytes, str]] = {}
_MAX_PREVIEW_CACHE = 10


async def fetch_preview_audio(track_id: str) -> tuple[bytes, str]:
    """Fetches and buffers a 30s audio preview for a track in memory."""
    if track_id in _preview_cache:
        return _preview_cache[track_id]

    info = await api.get_stream_info(track_id, "LOW")
    stream_type = info.get("type")

    if stream_type == "dash":
        init_url = info.get("init_url")
        # In Tidal's DASH manifest, each segment is ~4s. 8 segments = ~32s preview (~380 KB)
        segment_urls = info.get("segment_urls", [])[:8]
        if not segment_urls and not init_url:
            raise Exception("No audio segments found for preview.")

        urls_to_fetch = []
        if init_url:
            urls_to_fetch.append(init_url)
        urls_to_fetch.extend(segment_urls)

        session = await api.get_session()
        async def _fetch(u: str) -> bytes:
            if not u:
                return b""
            async with session.get(u, timeout=aiohttp.ClientTimeout(total=15)) as r:
                r.raise_for_status()
                return await r.read()

        results = await asyncio.gather(*[_fetch(u) for u in urls_to_fetch])
        combined = b"".join(results)
        media_type = "audio/mp4"

        if len(_preview_cache) >= _MAX_PREVIEW_CACHE:
            oldest = next(iter(_preview_cache))
            _preview_cache.pop(oldest, None)
        _preview_cache[track_id] = (combined, media_type)
        return combined, media_type

    elif stream_type == "direct":
        url = info.get("url")
        if not url:
            raise Exception("No stream URL found for preview.")
        ext = info.get("extension", "m4a")
        media_type = "audio/flac" if ext == "flac" else "audio/mp4"

        session = await api.get_session()
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
            r.raise_for_status()
            # Read up to 1.5MB for preview
            content = await r.content.read(1500 * 1024)
            if len(_preview_cache) >= _MAX_PREVIEW_CACHE:
                oldest = next(iter(_preview_cache))
                _preview_cache.pop(oldest, None)
            _preview_cache[track_id] = (content, media_type)
            return content, media_type
    else:
        raise Exception(f"Unsupported stream type: {stream_type}")


@app.get("/preview/{track_id}")
async def get_preview_endpoint(track_id: str):
    """Pre-caches and validates audio stream preview URL for 30s playback."""
    require_auth()
    try:
        # Pre-fetch preview so browser playback starts instantly with 0 latency
        await fetch_preview_audio(track_id)
        return {
            "status": "success",
            "preview_url": f"/preview/{track_id}/audio.m4a"
        }
    except Exception as e:
        print(f"Preview error for track {track_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/preview/{track_id}/audio.m4a")
async def get_preview_audio_stream(track_id: str, request: Request):
    """Serves 30s audio stream with Range header support for browser <audio> players."""
    require_auth()
    try:
        audio_data, media_type = await fetch_preview_audio(track_id)
    except Exception as e:
        print(f"Preview audio error for track {track_id}: {e}")
        raise HTTPException(status_code=404, detail=f"Preview unavailable: {e}")

    total_len = len(audio_data)
    range_header = request.headers.get("range")

    if range_header and range_header.startswith("bytes="):
        try:
            parts = range_header.replace("bytes=", "").split("-")
            if not parts[0] and len(parts) > 1 and parts[1]:
                # Suffix range: bytes=-500 means last 500 bytes
                suffix_len = int(parts[1])
                start = max(0, total_len - suffix_len)
                end = total_len - 1
            else:
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if len(parts) > 1 and parts[1] else total_len - 1
            start = max(0, min(start, total_len - 1))
            end = max(start, min(end, total_len - 1))
            chunk = audio_data[start : end + 1]
            headers = {
                "Content-Range": f"bytes {start}-{end}/{total_len}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(chunk)),
                "Content-Type": media_type,
                "Cache-Control": "public, max-age=86400",
            }
            return Response(content=chunk, status_code=206, headers=headers, media_type=media_type)
        except Exception:
            pass

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(total_len),
        "Content-Type": media_type,
        "Cache-Control": "public, max-age=86400",
    }
    return Response(content=audio_data, status_code=200, headers=headers, media_type=media_type)



class BatchResolveRequest(BaseModel):
    urls: list[str]

@app.post("/batch/resolve")
async def batch_resolve_endpoint(req: BatchResolveRequest):
    """Resolves multiple URLs (Tidal or cross-platform links) to items for batch download."""
    require_auth()
    
    async def resolve_single(raw_url: str):
        u = raw_url.strip()
        if not u:
            return None
            
        url_type, url_id = parse_tidal_url(u)
        if url_type:
            try:
                if url_type == "track":
                    item = await api.get_track(url_id)
                    return {"type": "track", "item": item, "original_url": u}
                elif url_type == "album":
                    item = await api.get_album(url_id)
                    return {"type": "album", "item": item, "original_url": u}
                elif url_type == "playlist":
                    item = await api.get_playlist(url_id)
                    return {"type": "playlist", "item": item, "original_url": u}
            except Exception as e:
                print(f"Error resolving Tidal link {u}: {e}")
            return None

        ext_type, ext_query, platform_name = await resolve_external_link(u)
        if ext_query:
            try:
                target_type = (ext_type + "s") if ext_type else "tracks"
                res = await api.search(ext_query, limit=1)
                cat = res.get(target_type, {}) if isinstance(res.get(target_type), dict) else {}
                items = cat.get("items", [])
                if items:
                    return {
                        "type": ext_type or "track",
                        "item": items[0],
                        "converted_from": platform_name,
                        "original_url": u
                    }
            except Exception as e:
                print(f"Error resolving external link {u}: {e}")
        return None
    
    results = await asyncio.gather(*[resolve_single(u) for u in req.urls])
    resolved_items = [r for r in results if r is not None]
    return {"resolved": resolved_items}


class SettingsRequest(BaseModel):
    quality_tier: str | None = None
    allow_dolby_atmos: bool | None = None
    r2_enabled: bool | None = None
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket_name: str | None = None
    r2_public_domain: str | None = None

@app.get("/settings")
def get_settings():
    require_auth()
    tier = config.quality_tier
    if tier == "HI_RES_LOSSLESS":
        tier = "MAX"
    return {
        "quality_tier": tier,
        "allow_dolby_atmos": config.allow_dolby_atmos,
        "download_directory": config.download_directory,
        "r2_enabled": config.r2_enabled,
        "r2_configured": r2_storage.is_configured()
    }

@app.post("/settings")
def update_settings(req: SettingsRequest):
    require_auth()
    if req.quality_tier:
        tier = req.quality_tier
        if tier == "MAX":
            tier = "HI_RES_LOSSLESS"
        config.quality_tier = tier
    if req.allow_dolby_atmos is not None:
        config.allow_dolby_atmos = req.allow_dolby_atmos
    if req.r2_enabled is not None:
        config.r2_enabled = req.r2_enabled
    if req.r2_account_id is not None:
        config.r2_account_id = req.r2_account_id
    if req.r2_access_key_id is not None:
        config.r2_access_key_id = req.r2_access_key_id
    if req.r2_secret_access_key is not None and "*" not in req.r2_secret_access_key:
        config.r2_secret_access_key = req.r2_secret_access_key
    if req.r2_bucket_name is not None:
        config.r2_bucket_name = req.r2_bucket_name
    if req.r2_public_domain is not None:
        config.r2_public_domain = req.r2_public_domain
    config.save()
    return {"status": "success", "r2_configured": r2_storage.is_configured()}

if __name__ == "__main__":
    import uvicorn
    raw_port = os.environ.get("PORT", "8000")
    try:
        port = int(raw_port)
    except Exception:
        port = 8000
    print(f"Starting Tidal Rip API on 0.0.0.0:{port}...", flush=True)
    uvicorn.run("server:app", host="0.0.0.0", port=port, workers=1, reload=False)
