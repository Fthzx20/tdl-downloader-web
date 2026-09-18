import os
import sys

# Flush stdout immediately for container log streaming
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

# Ensure web_backend is on the Python path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from server import app

if __name__ == "__main__":
    import uvicorn
    raw_port = os.environ.get("PORT", "3000")
    try:
        port = int(raw_port)
    except Exception:
        port = 3000
    print(f"Starting Tidal Rip API on 0.0.0.0:{port} from root runner...", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port)
