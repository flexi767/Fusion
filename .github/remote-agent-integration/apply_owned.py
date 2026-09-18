"""FNXC:RemoteAgents 2026-09-18-21:02: Validate only the exact owned package on the exact upstream commit before running integration CI."""
from pathlib import Path, PurePosixPath
import hashlib
import gzip
import json
import os
import subprocess

prepared = Path(os.environ["FUSION_REMOTE_PREPARED_DIR"])
repo = Path.cwd()
manifest = json.loads((prepared / "PROVENANCE.json").read_text())
archive = prepared / manifest["archive"]["file"]
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest["archive"]["sha256"]
patch = prepared / manifest["patch"]
patch.write_bytes(gzip.decompress(archive.read_bytes()))


def git(*args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).rstrip("\n")


assert git("rev-parse", "HEAD") == manifest["upstreamSha"], "Upstream identity changed"
assert not git("status", "--porcelain"), "Checkout must be clean"
assert hashlib.sha256(patch.read_bytes()).hexdigest() == manifest["sha256"], "Package digest changed"
names = [item["path"] for item in manifest["files"]]
assert len(names) == 58 and len(set(names)) == 58
assert not set(names).intersection(manifest["excluded"])
for item in manifest["files"]:
    name = item["path"]
    path = PurePosixPath(name)
    assert not path.is_absolute() and ".." not in path.parts
    target = repo / name
    if item["upstreamBlob"] is None:
        assert not target.exists(), "Owned addition already exists: " + name
    else:
        assert target.is_file() and not target.is_symlink(), name
        assert git("hash-object", "--", name) == item["upstreamBlob"], "Base changed: " + name

subprocess.run(["git", "-C", str(repo), "apply", "--check", str(patch)], check=True)
subprocess.run(["git", "-C", str(repo), "apply", str(patch)], check=True)
changed = git("status", "--porcelain", "--untracked-files=all", "-z").split("\0")
assert {entry[3:] for entry in changed if entry}.issubset(set(names)), "Unexpected path changed"
for item in manifest["files"]:
    assert hashlib.sha256((repo / item["path"]).read_bytes()).hexdigest() == item["resolvedSha256"], item["path"]
subprocess.run(["git", "-C", str(repo), "add", "--", *names], check=True)
assert set(git("diff", "--cached", "--name-only").splitlines()).issubset(set(names))
subprocess.run(["git", "-C", str(repo), "diff", "--cached", "--check"], check=True)
print("Applied and verified 58 owned paths against upstream " + manifest["upstreamSha"])
