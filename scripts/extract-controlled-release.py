"""Extract only the sealed release members after Node verifies the pinned ZIP."""
import io
from pathlib import Path, PurePosixPath
import sys
import tarfile
import zipfile


def extract_release(archive, destination):
    with zipfile.ZipFile(archive) as zipped:
        entries = zipped.infolist()
        if len(entries) != 1 or entries[0].filename != "release.tar":
            raise ValueError("artifact must contain exactly release.tar")
        if entries[0].file_size > 512 * 1024 * 1024:
            raise ValueError("release archive too large")
        with tarfile.open(fileobj=io.BytesIO(zipped.read(entries[0])), mode="r:") as release:
            members = release.getmembers()
            names = set()
            for member in members:
                name = member.name.rstrip("/")
                parts = PurePosixPath(name).parts
                if (not parts or name.startswith("/") or ".." in parts
                        or "\\" in name or name in names
                        or not (member.isfile() or member.isdir())):
                    raise ValueError("unsafe or duplicate release member")
                names.add(name)
                if not (parts[0] in ("dist", "migrations")
                        or (len(parts) == 1 and member.isfile() and name in
                            ("wrangler.jsonc", "package-lock.json", "release.json"))):
                    raise ValueError("unexpected release member")
            if sum(m.size for m in members) > 512 * 1024 * 1024:
                raise ValueError("expanded release too large")
            # data rejects filesystem links/escaping paths as a second boundary.
            release.extractall(Path(destination), members=members, filter="data")


if __name__ == "__main__":
    extract_release(*sys.argv[1:])
