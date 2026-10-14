"""Opt-in verification against a running, updated Felo app. Audio is tested muted."""
import argparse
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", required=True)
    parser.add_argument("--restore", type=Path, help="Saved sanitized status from before restarting Felo.")
    options = parser.parse_args()
    process = subprocess.Popen([sys.executable, str(ROOT / "resources/hermes/felo-control.py"), "mcp"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
    seq = 0
    timings = {}
    original = None
    added_id = None
    selected_id = None

    def rpc(method, params=None):
        nonlocal seq
        seq += 1
        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": seq, "method": method, "params": params or {}}) + "\n")
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        assert response["id"] == seq, response
        assert "error" not in response, response
        return response["result"]

    def call(name, args=None, label=None):
        before = time.perf_counter()
        result = rpc("tools/call", {"name": name, "arguments": args or {}})
        data = json.loads(result["content"][0]["text"])
        assert not result.get("isError"), data
        if label:
            timings[label] = round((time.perf_counter() - before) * 1000)
        return data

    try:
        rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "felo-smoke", "version": "1"}})
        tools = rpc("tools/list")["tools"]
        assert len(tools) == 12
        state = call("felo_status", label="status")
        assert state["ready"] and state["apiVersion"] == 2, state
        original = {**state, **json.loads(options.restore.read_text(encoding="utf-8-sig"))} if options.restore else state
        search = call("felo_search_songs", {"query": "STAY", "artist": "The Kid LAROI"}, "search")
        selected_id = search["suggestedSongId"]
        assert selected_id, search
        # Explicit user-facing feature verification, no unexpected audible playback.
        played = call("felo_play", {"query": "STAY", "artist": "The Kid LAROI", "volume_percent": 0}, "search_and_play")
        assert played["state"]["isPlaying"] and played["state"]["song"]["id"] == selected_id
        assert played["state"]["outputMuted"] and played["warnings"]
        paused = call("felo_pause", label="pause")
        assert not paused["state"]["isPlaying"]
        position = paused["state"]["position"]
        time.sleep(0.15)
        assert abs(call("felo_status")["position"] - position) < 0.05
        resumed = call("felo_play", label="resume")
        assert resumed["state"]["isPlaying"]
        sought = call("felo_seek", {"seconds": 20}, "seek")
        assert 19.5 < sought["state"]["position"] < 20.5
        replayed = call("felo_play", {"song_id": selected_id}, "replay_same_song")
        assert replayed["state"]["position"] < 1
        assert replayed["state"]["isPlaying"]

        candidates = call("felo_search_songs", {"query": "", "limit": 20})["results"]
        before_queue = call("felo_queue")["queue"]
        existing = {song["id"] for song in before_queue}
        added_id = next(song["id"] for song in candidates if song["available"] and song["id"] not in existing and song["duration"] > 30)
        retry_id = str(uuid.uuid4())
        queued = call("felo_enqueue", {"song_id": added_id, "request_id": retry_id}, "enqueue")
        retried = call("felo_enqueue", {"song_id": added_id, "request_id": retry_id})
        assert retried == queued
        assert call("felo_queue")["total"] == len(before_queue) + 1
        call("felo_set_mode", {"shuffle": False, "repeat": "off"})
        skipped = call("felo_next", label="next")
        assert skipped["state"]["song"]["id"] == added_id
        previous = call("felo_previous", label="previous")
        assert previous["state"]["song"]["id"] == selected_id
        call("felo_seek", {"seconds": 10})
        restarted = call("felo_previous")
        assert restarted["state"]["position"] < 1
        call("felo_remove_from_queue", {"song_id": added_id}, "remove")
        added_id = None
        changed = call("felo_set_mode", {"shuffle": True, "repeat": "one"}, "mode")
        assert changed["state"]["shuffle"] and changed["state"]["repeat"] == "one"
        call("felo_pause")
        volume = call("felo_set_volume", {"percent": 40}, "volume")
        assert volume["state"]["volumePercent"] == 40 and not volume["state"]["outputMuted"]
        print(json.dumps({"passed": True, "tools": len(tools), "latency_ms": timings}, indent=2))
    finally:
        if original is not None:
            try:
                call("felo_pause")
                restore_song = original.get("song")
                if restore_song:
                    call("felo_play", {"song_id": restore_song["id"], "volume_percent": 0})
                    call("felo_pause")
                    if original.get("position", 0) > 0:
                        call("felo_seek", {"seconds": min(original["position"], max(0, original.get("duration", 0) - 0.5))})
                if added_id and added_id != (restore_song or {}).get("id"):
                    call("felo_remove_from_queue", {"song_id": added_id})
                call("felo_set_mode", {"shuffle": original.get("shuffle", False), "repeat": original.get("repeat", "off")})
                call("felo_set_volume", {"percent": round(original.get("volume", 0.4) * 100)})
                if original.get("isPlaying"):
                    call("felo_play")
            except Exception as exc:
                print("Restoration requires attention: " + str(exc), file=sys.stderr)
                raise
        process.stdin.close()
        process.wait(timeout=10)


if __name__ == "__main__":
    main()

