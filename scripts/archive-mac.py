"""Archive a macOS app with Unix permissions and framework symlinks intact."""

import os
from pathlib import Path
import stat
import sys
import time
import zipfile

bundle = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()


def add_link(archive, path):
    metadata = path.lstat()
    info = zipfile.ZipInfo(str(Path(bundle.name) / path.relative_to(bundle)))
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    info.date_time = time.localtime(metadata.st_mtime)[:6]
    archive.writestr(info, os.readlink(path).encode("utf-8"))


with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for directory, directories, files in os.walk(bundle, followlinks=False):
        current = Path(directory)
        archive.write(current, str(Path(bundle.name) / current.relative_to(bundle)))
        for name in list(directories):
            child = current / name
            if child.is_symlink():
                add_link(archive, child)
                directories.remove(name)
        for name in files:
            child = current / name
            if child.is_symlink():
                add_link(archive, child)
            else:
                archive.write(child, str(Path(bundle.name) / child.relative_to(bundle)))

with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None, "The ZIP failed its integrity check."
    assert any(stat.S_ISLNK(item.external_attr >> 16) for item in archive.infolist()), "Framework symlinks are missing."
    binary = f"{bundle.name}/Contents/MacOS/Document"
    assert archive.read(binary) == (bundle / "Contents/MacOS/Document").read_bytes(), "The archive contains a different executable."

print(f"Created {destination.name} with framework symlinks and executable permissions.")
