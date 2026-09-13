import re
import os
import shutil
import asyncio
import zipfile
import time
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tidal_rip.config import Config
from tidal_rip.api import TidalAPI
from tidal_rip.downloader import DownloadManager, sanitize_filename

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

# Make sure temp directory exists for zipping
TEMP_DIR = os.path.expanduser("~/Music/Tidal_Temp_Zips")
os.makedirs(TEMP_DIR, exist_ok=True)


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


def cleanup_file(path: str):
    """Background task to remove a file/zip after sending it."""
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"Failed to cleanup {path}: {e}")


def cleanup_dir(path: str):
    """Background task to remove a directory after sending its zip."""
    try:
        if os.path.exists(path):
            shutil.rmtree(path)
    except Exception as e:
        print(f"Failed to cleanup {path}: {e}")


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
    except Exception as e:
        print(f"Error purging stale cache: {e}")


@app.on_event("startup")
async def startup_event():
    # Purge any old leftover temp files on startup
    purge_stale_temp_cache(max_age_seconds=300)
    # If token exists, verify session
    if config.access_token:
        try:
            await api.fetch_session_info()
            print("Session verified on startup.")
        except Exception:
            pass


@app.post("/system/clear_cache")
def clear_cache_endpoint():
    """Manually purges temporary files, zip archives, and cached temp files."""
    purge_stale_temp_cache(max_age_seconds=0) # Clear all immediately
    return {"status": "success", "message": "Server temporary cache cleared."}


@app.get("/")
def root():
    return {"status": "ok", "message": "Tidal Rip API is running."}


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

        # Standard keyword search query
        res = await api.search(query_str, limit=50)
        
        # Extract category data
        category_data = res.get(type, {}) if isinstance(res.get(type), dict) else {}
        items = list(category_data.get("items", []))
        
        # Check topHit for exact match prioritization
        top_hit = res.get("topHit")
        if top_hit and isinstance(top_hit, dict):
            top_hit_item = top_hit.get("value")
            top_hit_type = str(top_hit.get("type", "")).lower()
            
            # Match topHit type with request type (singular vs plural e.g. track vs tracks)
            if top_hit_item and isinstance(top_hit_item, dict) and (top_hit_type == type or top_hit_type == type.rstrip("s")):
                top_hit_id = top_hit_item.get("id")
                if top_hit_id is not None:
                    items = [item for item in items if item.get("id") != top_hit_id]
                    items.insert(0, top_hit_item)
            
        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


active_tasks = {}

def create_progress_callback(task_id: str, track_id: str):
    async def cb(downloaded, total, status):
        if not task_id: return
        if task_id not in active_tasks:
            active_tasks[task_id] = {}
        active_tasks[task_id][track_id] = {
            "downloaded": downloaded,
            "total": total,
            "status": status,
            "time": time.time()
        }
    return cb

@app.get("/progress/{task_id}")
def get_progress(task_id: str):
    # Clean up old tasks inactive for > 10 minutes (600s) to prevent memory leak
    now = time.time()
    expired = [
        tid for tid, tracks in list(active_tasks.items())
        if tracks and all(now - t.get("time", 0) > 600 for t in tracks.values())
    ]
    for tid in expired:
        del active_tasks[tid]

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


@app.get("/download/track/{track_id}")
async def download_track(track_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads a single track and returns the audio file directly."""
    require_auth()
    try:
        cb = create_progress_callback(task_id, track_id) if task_id else None
        final_path = await downloader.download_track(track_id, progress_callback=cb)
        if not final_path or not os.path.exists(final_path):
            raise Exception("Download failed or skipped.")
            
        filename = os.path.basename(final_path)
        parent_dir = os.path.dirname(final_path)
        
        # Schedule cleanup AFTER the response is fully sent to the client
        background_tasks.add_task(cleanup_file, final_path)
        # Also cleanup the companion .lrc lyrics file
        lrc_path = os.path.splitext(final_path)[0] + ".lrc"
        if os.path.exists(lrc_path):
            background_tasks.add_task(cleanup_file, lrc_path)
        # Cleanup empty directories to free disk space on Render
        background_tasks.add_task(cleanup_empty_dir, parent_dir)
        
        return FileResponse(final_path, media_type='application/octet-stream', filename=filename)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/download/album/{album_id}")
async def download_album(album_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads an album, zips it, and returns the zip file."""
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
            
        sem = asyncio.Semaphore(2)
        async def sem_download(tid, parent, cb):
            async with sem:
                return await downloader.download_track(tid, parent_folder=parent, progress_callback=cb)

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
        
        uid_tag = task_id if task_id else str(int(time.time() * 1000))
        zip_path = os.path.join(TEMP_DIR, f"{safe_album}_{uid_tag}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root_dir, dirs, files in os.walk(album_dir):
                for file in files:
                    file_path = os.path.join(root_dir, file)
                    arcname = os.path.relpath(file_path, album_dir)
                    zipf.write(file_path, arcname)
                    
        background_tasks.add_task(cleanup_dir, album_dir)
        background_tasks.add_task(cleanup_file, zip_path)
        
        return FileResponse(zip_path, media_type='application/zip', filename=f"{safe_album}.zip")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/playlist/{playlist_id}")
async def download_playlist(playlist_id: str, background_tasks: BackgroundTasks, task_id: str = None):
    """Downloads a playlist, zips it, and returns the zip file."""
    require_auth()
    try:
        # Free disk space before a large download operation
        purge_stale_temp_cache(max_age_seconds=60)
        
        playlist = await api.get_playlist(playlist_id)
        safe_playlist = sanitize_filename(playlist.get("title", "Playlist"))
        
        items = await api.get_playlist_tracks(playlist_id)
        if not items:
            raise Exception("No tracks found in this playlist.")
            
        sem = asyncio.Semaphore(2)
        async def sem_download(tid, parent, cb):
            async with sem:
                return await downloader.download_track(tid, parent_folder=parent, progress_callback=cb)

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
        
        uid_tag = task_id if task_id else str(int(time.time() * 1000))
        zip_path = os.path.join(TEMP_DIR, f"{safe_playlist}_{uid_tag}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root_dir, dirs, files in os.walk(playlist_dir):
                for file in files:
                    file_path = os.path.join(root_dir, file)
                    arcname = os.path.relpath(file_path, playlist_dir)
                    zipf.write(file_path, arcname)
                    
        background_tasks.add_task(cleanup_dir, playlist_dir)
        background_tasks.add_task(cleanup_file, zip_path)
        
        return FileResponse(zip_path, media_type='application/zip', filename=f"{safe_playlist}.zip")
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


class SettingsRequest(BaseModel):
    quality_tier: str | None = None
    allow_dolby_atmos: bool | None = None

@app.get("/settings")
def get_settings():
    return {
        "quality_tier": config.quality_tier,
        "allow_dolby_atmos": config.allow_dolby_atmos,
        "download_directory": config.download_directory
    }

@app.post("/settings")
def update_settings(req: SettingsRequest):
    if req.quality_tier:
        config.quality_tier = req.quality_tier
    if req.allow_dolby_atmos is not None:
        config.allow_dolby_atmos = req.allow_dolby_atmos
    config.save()
    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
