import os, sys, argparse, numpy as np, pydicom
from threading import Event
from matplotlib import pyplot as plt
from PIL import Image
"""
Cooperative cancellation support:
- External code can set `cancel_event` to request early stop.
- `save_pngs` and `crop_pngs` periodically check and exit early when set.
"""
cancel_event: Event = Event()


# ---- load frames from a DICOM (exact match to your reference) ----
def load_frames(ds):
    arr = ds.pixel_array

    if arr.ndim == 2:                      # single frame gray
        frames = [arr]

    elif arr.ndim == 3:
        if arr.shape[-1] in (3, 4):        # (H, W, 3/4) -> one RGB frame
            frames = [arr[..., :3]]
        else:                               # (N, H, W) stack
            frames = [arr[i] for i in range(arr.shape[0])]

    elif arr.ndim == 4:                     # (N, H, W, 3/4)
        frames = [arr[i, ..., :3] for i in range(arr.shape[0])]

    else:
        frames = []

    return frames

# ---- save frames as PNGs (exact match to your reference) ----
def save_pngs(frames, base, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for i, f in enumerate(frames, 1):
        if cancel_event.is_set():
            break
            
        if f.ndim == 3:  # RGB to grayscale
            f = np.mean(f, axis=-1)

        out_name = f"{base}_frame_{i:03d}.png"
        out_path = os.path.join(out_dir, out_name)
        plt.imsave(out_path, f, cmap="gray", vmin=f.min(), vmax=f.max())
        written.append(out_path)
    return written

# ---- crop PNGs with the exact crop box ----
def crop_pngs(files, out_dir, top=65, left=66, right=150):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for fp in files:
        if cancel_event.is_set():
            break
        img = Image.open(fp)
        w, h = img.size
        # crop(left, top, right, bottom) -> right is x-coordinate, so use w - right
        cropped = img.crop((left, top, w - right, h))
        out_path = os.path.join(out_dir, os.path.basename(fp))
        cropped.save(out_path)
        written.append(out_path)
    return written

def process_single_dcm(dcm_path, out_raw="Processed_PNGs", out_cropped="Processed_PNGs_cropped"):
    ds = pydicom.dcmread(dcm_path)
    frames = load_frames(ds)
    if not frames:
        return [], []

    # Use the file's stem as the base name (no special parsing)
    base = os.path.splitext(os.path.basename(dcm_path))[0]
    if cancel_event.is_set():
        return [], []
    raw_files = save_pngs(frames, base, out_raw)
    if cancel_event.is_set():
        return raw_files, []
    cropped_files = crop_pngs(raw_files, out_cropped, top=65, left=66, right=150)
    return raw_files, cropped_files

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dcm", required=True, help="path to a single .dcm file")
    ap.add_argument("--out-raw", default="Processed_PNGs")
    ap.add_argument("--out-cropped", default="Processed_PNGs_cropped")
    args = ap.parse_args()

    try:
        raw_files, cropped_files = process_single_dcm(args.dcm, args.out_raw, args.out_cropped)
        print(f"wrote {len(raw_files)} PNG frames to {args.out_raw}")
        print(f"wrote {len(cropped_files)} cropped PNGs to {args.out_cropped}")
    except Exception as e:
        print(f"failed on {args.dcm}: {e}", file=sys.stderr)
        sys.exit(1)
