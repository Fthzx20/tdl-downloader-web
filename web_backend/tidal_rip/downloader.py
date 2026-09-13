import os
import re
import shutil
import aiohttp
import aiofiles
import asyncio
import subprocess
import time
import imageio_ffmpeg
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4, MP4Cover

def get_ffmpeg_binary():
    """Finds available ffmpeg binary from PATH or imageio_ffmpeg."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def sanitize_filename(name):
    """Sanitizes strings to be safe for file paths across Windows/macOS/Linux."""
    if not name:
        return "Untitled"
    clean = re.sub(r'[\/:*?"<>|]', '_', str(name)).strip('. ')
    return clean if clean else "Untitled"

class DownloadManager:
    """Manages queueing, downloading, and tagging of Tidal tracks."""
    
    def __init__(self, api, config):
        self.api = api
        self.config = config
        self.is_paused = False
        self.is_cancelled = False

    async def download_track(self, track_id, progress_callback=None, parent_folder=None, task_state=None):
        """Downloads a track, parses manifest, concatenates segments, and writes tags.
        
        progress_callback: func(bytes_downloaded, total_bytes, status_text)
        parent_folder: str (optional) A custom folder name to save the track in (e.g., Playlist Name)
        task_state: dict (optional) Dictionary containing {"is_paused": bool, "is_cancelled": bool}
        """
        if progress_callback:
            await progress_callback(0, 1, "Fetching metadata...")

        # 1. Fetch Track & Album Metadata
        track = await self.api.get_track(track_id)
        album_info = track.get("album") or {}
        album_id = album_info.get("id")
        
        album = {}
        if album_id:
            try:
                album = await self.api.get_album(album_id)
            except Exception:
                album = album_info
        else:
            album = album_info
        
        # Track details
        title = track.get("title", "Untitled Track")
        artist_obj = track.get("artist") or (track.get("artists", [{}])[0] if track.get("artists") else {})
        artist_name = artist_obj.get("name", "Unknown Artist")
        album_title = album.get("title", "Unknown Album")
        track_num = track.get("trackNumber") or 1
        total_tracks = album.get("numberOfTracks") or 1
        disc_num = track.get("volumeNumber") or 1
        release_date = album.get("releaseDate", "")
        genre = album.get("genre", "")
        
        # Format the output paths
        safe_artist = sanitize_filename(artist_name)
        safe_album = sanitize_filename(album_title)
        safe_title = sanitize_filename(title)
        
        if parent_folder:
            safe_parent = sanitize_filename(parent_folder)
            album_dir = os.path.join(self.config.download_directory, safe_parent)
        else:
            album_dir = os.path.join(self.config.download_directory, safe_artist, safe_album)
            
        os.makedirs(album_dir, exist_ok=True)
        
        # Smart Skip
        flac_path = os.path.join(album_dir, f"{track_num:02d} - {safe_title}.flac")
        m4a_path = os.path.join(album_dir, f"{track_num:02d} - {safe_title}.m4a")
        if os.path.exists(flac_path) and os.path.getsize(flac_path) > 0:
            if progress_callback:
                await progress_callback(1, 1, "Skipped (Already Downloaded)")
            return flac_path
        if os.path.exists(m4a_path) and os.path.getsize(m4a_path) > 0:
            if progress_callback:
                await progress_callback(1, 1, "Skipped (Already Downloaded)")
            return m4a_path
            
        # 1.5 Fetch Lyrics
        lyrics_text = ""
        if progress_callback:
            await progress_callback(0, 1, "Fetching lyrics...")
        try:
            lyrics_data = await self.api.get_track_lyrics(track_id)
            if lyrics_data:
                lrc_path = os.path.join(album_dir, f"{track_num:02d} - {safe_title}.lrc")
                if lyrics_data.get("subtitles"):
                    lyrics_text = lyrics_data["subtitles"]
                elif lyrics_data.get("lyrics"):
                    lyrics_text = lyrics_data["lyrics"]
                if lyrics_text:
                    with open(lrc_path, "w", encoding="utf-8-sig") as f:
                        f.write(lyrics_text)
        except Exception as e:
            print(f"Failed to fetch lyrics for {track_id}: {e}")
            
        # 2. Fetch Stream Info
        quality = self.config.quality_tier
        if progress_callback:
            await progress_callback(0, 1, "Fetching stream URL...")
            
        try:
            stream_info = await self.api.get_stream_info(track_id, quality)
        except Exception as e:
            raise Exception(f'"{title}" by {artist_name} is unavailable or region-restricted on Tidal.')
        ext = stream_info["extension"]
        
        filename = f"{track_num:02d} - {safe_title}.{ext}"
        final_path = os.path.join(album_dir, filename)
        temp_path = final_path + ".tmp"
        
        # 3. Perform Download
        session = await self.api.get_session()
        try:
            if stream_info["type"] == "direct":
                # Direct file download
                url = stream_info["url"]
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        downloaded = 0
                        if os.path.exists(temp_path):
                            downloaded = os.path.getsize(temp_path)
                            
                        headers = {}
                        if downloaded > 0:
                            headers["Range"] = f"bytes={downloaded}-"
                            
                        async with session.get(url, headers=headers) as resp:
                            resp.raise_for_status()
                            if resp.status == 206:
                                mode = "ab"
                                total_size = int(resp.headers.get("Content-Length", 0)) + downloaded
                            else:
                                downloaded = 0
                                mode = "wb"
                                total_size = int(resp.headers.get("Content-Length", 0))

                            last_time = time.time()
                            last_downloaded = downloaded
                            smoothed_speed = None
                            
                            async with aiofiles.open(temp_path, mode) as f:
                                async for chunk in resp.content.iter_chunked(1024 * 64):
                                    is_paused = self.is_paused or (task_state and task_state.get("is_paused", False))
                                    is_cancelled = self.is_cancelled or (task_state and task_state.get("is_cancelled", False))
                                    
                                    while is_paused and not is_cancelled:
                                        await asyncio.sleep(0.5)
                                        is_paused = self.is_paused or (task_state and task_state.get("is_paused", False))
                                        is_cancelled = self.is_cancelled or (task_state and task_state.get("is_cancelled", False))
                                        
                                    if is_cancelled:
                                        raise Exception("Cancelled by user")
                                        
                                    await f.write(chunk)
                                    downloaded += len(chunk)
                                    
                                    now = time.time()
                                    if now - last_time >= 0.5:
                                        current_speed = (downloaded - last_downloaded) / (now - last_time) # bytes/sec
                                        if smoothed_speed is None:
                                            smoothed_speed = current_speed
                                        else:
                                            smoothed_speed = 0.5 * smoothed_speed + 0.5 * current_speed
                                            
                                        last_time = now
                                        last_downloaded = downloaded
                                        if progress_callback:
                                            await progress_callback(downloaded, total_size, f"Downloading: {downloaded / 1024 / 1024:>5.1f}MB / {total_size / 1024 / 1024:>5.1f}MB       ({smoothed_speed / 1024 / 1024:>4.1f} MB/s)")
                        break # Exit retry loop on success
                    except Exception as e:
                        if (task_state and task_state.get("is_cancelled", False)) or self.is_cancelled or attempt == max_retries - 1:
                            raise e
                        if progress_callback:
                            await progress_callback(downloaded, 1, f"Network Error. Retrying ({attempt+1}/{max_retries})...")
                        await asyncio.sleep(2)
                                
            elif stream_info["type"] == "dash":
                # Fragmented DASH download with binary concatenation
                init_url = stream_info["init_url"]
                segment_urls = stream_info["segment_urls"]
                
                # Estimate total size if possible
                total_segments = len(segment_urls)
                downloaded = 0
                last_time = time.time()
                last_downloaded = 0
                smoothed_speed = None
                
                async with aiofiles.open(temp_path, "wb") as f:
                    # Download initialization segment
                    if init_url:
                        if progress_callback:
                            await progress_callback(0, total_segments, "Downloading initialization segment...")
                        async with session.get(init_url) as resp:
                            resp.raise_for_status()
                            await f.write(await resp.read())
                    
                    # Download each media segment in order
                    for idx, seg_url in enumerate(segment_urls):
                        is_paused = self.is_paused or (task_state and task_state.get("is_paused", False))
                        is_cancelled = self.is_cancelled or (task_state and task_state.get("is_cancelled", False))
                        
                        while is_paused and not is_cancelled:
                            await asyncio.sleep(0.5)
                            is_paused = self.is_paused or (task_state and task_state.get("is_paused", False))
                            is_cancelled = self.is_cancelled or (task_state and task_state.get("is_cancelled", False))
                            
                        if is_cancelled:
                            raise Exception("Cancelled by user")
                            
                        max_retries = 3
                        for attempt in range(max_retries):
                            try:
                                if progress_callback:
                                    if attempt > 0:
                                        await progress_callback(idx, total_segments, f"Retrying segment {idx + 1:02d}/{total_segments:02d}... ({attempt}/{max_retries})")
                                    else:
                                        await progress_callback(idx, total_segments, f"Downloading segment {idx + 1:02d}/{total_segments:02d}...")
                                        
                                async with session.get(seg_url) as resp:
                                    resp.raise_for_status()
                                    async for chunk in resp.content.iter_chunked(1024 * 64):
                                        await f.write(chunk)
                                        downloaded += len(chunk)
                                        
                                        now = time.time()
                                        if now - last_time >= 0.5:
                                            current_speed = (downloaded - last_downloaded) / (now - last_time) # bytes/sec
                                            if smoothed_speed is None:
                                                smoothed_speed = current_speed
                                            else:
                                                smoothed_speed = 0.5 * smoothed_speed + 0.5 * current_speed
                                                
                                            last_time = now
                                            last_downloaded = downloaded
                                            if progress_callback:
                                                await progress_callback(idx, total_segments, f"Downloading segment {idx + 1:02d}/{total_segments:02d}       ({smoothed_speed / 1024 / 1024:>4.1f} MB/s)")
                                break # Success
                            except Exception as e:
                                if (task_state and task_state.get("is_cancelled", False)) or self.is_cancelled or attempt == max_retries - 1:
                                    raise e
                                await asyncio.sleep(2)
                                
            # Convert/Extract container if needed for DASH streams
            if stream_info["type"] == "dash":
                if progress_callback:
                    await progress_callback(100, 100, "Processing audio container...")
                
                ffmpeg_exe = get_ffmpeg_binary()
                if ffmpeg_exe:
                    raw_out_path = final_path + ".clean.tmp"
                    try:
                        if ext == "flac":
                            cmd = [ffmpeg_exe, "-y", "-i", temp_path, "-c:a", "copy", "-f", "flac", raw_out_path]
                        else:
                            cmd = [ffmpeg_exe, "-y", "-i", temp_path, "-c:a", "copy", "-movflags", "+faststart", raw_out_path]

                        proc = await asyncio.create_subprocess_exec(
                            *cmd,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        )
                        
                        async def wait_ffmpeg():
                            return await proc.communicate()
                            
                        ff_task = asyncio.create_task(wait_ffmpeg())
                        while not ff_task.done():
                            if (task_state and task_state.get("is_cancelled", False)) or self.is_cancelled:
                                proc.kill()
                                raise Exception("Cancelled by user during extraction")
                            await asyncio.sleep(0.5)
                            
                        stdout, stderr = ff_task.result()
                        if proc.returncode == 0 and os.path.exists(raw_out_path) and os.path.getsize(raw_out_path) > 0:
                            os.remove(temp_path)
                            temp_path = raw_out_path
                        else:
                            err_msg = stderr.decode().strip().split('\n')[-1] if stderr else "Unknown error"
                            print(f"FFmpeg remux warning: {err_msg}. Keeping original file.")
                            if os.path.exists(raw_out_path):
                                os.remove(raw_out_path)
                    except Exception as e:
                        print(f"FFmpeg processing failed: {e}")

            if (task_state and task_state.get("is_cancelled", False)) or self.is_cancelled:
                raise Exception("Cancelled by user before tagging")
                
            # Rename temp file to final destination
            if os.path.exists(final_path):
                os.remove(final_path)
            os.rename(temp_path, final_path)
            
            # 4. Embedded Metadata Tagging
            if progress_callback:
                await progress_callback(100, 100, "Applying metadata tags...")
                
            cover_bytes = None
            cover_id = album.get("cover") or track.get("album", {}).get("cover") or track.get("cover")
            if cover_id:
                # Retrieve album artwork
                cover_url = f"https://resources.tidal.com/images/{cover_id.replace('-', '/')}/1280x1280.jpg"
                try:
                    async with session.get(cover_url) as resp:
                        if resp.status == 200:
                            cover_bytes = await resp.read()
                except Exception as e:
                    print(f"Failed to fetch album cover: {e}")
                    
            # Apply tags using Mutagen in a background thread to prevent blocking the async loop
            tags_dict = {
                "title": title,
                "artist": artist_name,
                "album": album_title,
                "track_num": track_num,
                "total_tracks": total_tracks,
                "disc_num": disc_num,
                "date": release_date,
                "genre": genre,
                "cover_bytes": cover_bytes,
                "lyrics": lyrics_text
            }
            await asyncio.to_thread(self.apply_metadata, final_path, ext, tags_dict)
            
            if progress_callback:
                await progress_callback(1, 1, "Completed")
            return final_path
            
        except Exception as e:
            # Clean up temp file on failure
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
            raise e

    def apply_metadata(self, filepath, ext, tags):
        """Applies metadata tags and cover art to the file safely."""
        try:
            cover_bytes = tags.get("cover_bytes")
            
            if ext == "flac":
                try:
                    audio = FLAC(filepath)
                except Exception as e:
                    print(f"Mutagen FLAC open error on {filepath}: {e}")
                    return

                audio["title"] = tags["title"]
                audio["artist"] = tags["artist"]
                audio["album"] = tags["album"]
                audio["tracknumber"] = str(tags["track_num"])
                audio["totaltracks"] = str(tags["total_tracks"])
                audio["discnumber"] = str(tags["disc_num"])
                if tags.get("date"):
                    audio["date"] = tags["date"]
                if tags.get("genre"):
                    audio["genre"] = tags["genre"]
                
                if cover_bytes:
                    try:
                        picture = Picture()
                        picture.data = cover_bytes
                        picture.type = 3  # Front cover
                        picture.mime = "image/jpeg"
                        picture.desc = "Front Cover"
                        audio.clear_pictures()
                        audio.add_picture(picture)
                    except Exception as e:
                        print(f"Failed to attach cover to FLAC: {e}")
                    
                if tags.get("lyrics"):
                    audio["LYRICS"] = tags["lyrics"]
                    audio["UNSYNCEDLYRICS"] = tags["lyrics"]
                    
                audio.save()
                
            elif ext == "m4a":
                try:
                    audio = MP4(filepath)
                except Exception as e:
                    print(f"Mutagen MP4 open error on {filepath}: {e}")
                    return

                audio["\xa9nam"] = tags["title"]
                audio["\xa9ART"] = tags["artist"]
                audio["\xa9alb"] = tags["album"]
                audio["trkn"] = [(tags["track_num"], tags["total_tracks"])]
                audio["disk"] = [(tags["disc_num"], 1)]
                if tags.get("date"):
                    audio["\xa9day"] = tags["date"]
                if tags.get("genre"):
                    audio["\xa9gen"] = tags["genre"]
                
                if cover_bytes:
                    try:
                        audio["covr"] = [MP4Cover(cover_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
                    except Exception as e:
                        print(f"Failed to attach cover to M4A: {e}")
                    
                if tags.get("lyrics"):
                    audio["\xa9lyr"] = tags["lyrics"]
                    
                audio.save()
        except Exception as e:
            print(f"apply_metadata error: {e}")
