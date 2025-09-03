from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
import sys
import os
import asyncio
import subprocess
sys.path.append(os.path.dirname(__file__))

app = FastAPI(title="Figo AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

def process_dcm_with_python311(dcm_path):
    """Process DICOM file using Python 3.11 with correct package versions"""
    try:
        # Create a Python 3.11 script to process the DICOM
        script_content = f'''
import os, sys, numpy as np, pydicom
from threading import Event
from matplotlib import pyplot as plt
from PIL import Image

# Cooperative cancellation support
cancel_event: Event = Event()

def load_frames(ds):
    arr = ds.pixel_array
    if arr.ndim == 2:
        frames = [arr]
    elif arr.ndim == 3:
        if arr.shape[-1] in (3, 4):
            frames = [arr[..., :3]]
        else:
            frames = [arr[i] for i in range(arr.shape[0])]
    elif arr.ndim == 4:
        frames = [arr[i, ..., :3] for i in range(arr.shape[0])]
    else:
        frames = []
    return frames

def save_pngs(frames, base, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for i, f in enumerate(frames, 1):
        if f.ndim == 3:
            f = np.mean(f, axis=-1)
        out_name = f"{{base}}_frame_{{i:03d}}.png"
        out_path = os.path.join(out_dir, out_name)
        plt.imsave(out_path, f, cmap="gray", vmin=f.min(), vmax=f.max())
        written.append(out_path)
    return written

def crop_pngs(files, out_dir, top=65, left=66, right=150):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for fp in files:
        img = Image.open(fp)
        w, h = img.size
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
    
    base = os.path.splitext(os.path.basename(dcm_path))[0]
    raw_files = save_pngs(frames, base, out_raw)
    cropped_files = crop_pngs(raw_files, out_cropped, top=65, left=66, right=150)
    return raw_files, cropped_files

# Process the DICOM file
dcm_path = "{dcm_path}"
out_raw = "Processed_PNGs"
out_cropped = "Processed_PNGs_cropped"

try:
    raw_files, cropped_files = process_single_dcm(dcm_path, out_raw, out_cropped)
    print(f"SUCCESS:{{len(raw_files)}}:{{len(cropped_files)}}")
except Exception as e:
    print(f"ERROR:{{str(e)}}")
'''
        
        # Write the script to a temporary file
        script_path = os.path.join(os.path.dirname(__file__), "temp_process.py")
        with open(script_path, 'w') as f:
            f.write(script_content)
        
        # Run the script with Python 3.11
        result = subprocess.run(['python3.11', script_path], 
                              capture_output=True, text=True, cwd=os.path.dirname(__file__))
        
        # Clean up the temporary script
        os.remove(script_path)
        
        if result.returncode == 0:
            output = result.stdout.strip()
            if output.startswith("SUCCESS:"):
                parts = output.split(":")
                raw_count = int(parts[1])
                cropped_count = int(parts[2])
                return raw_count, cropped_count
            else:
                raise Exception(f"Processing failed: {output}")
        else:
            raise Exception(f"Python 3.11 execution failed: {result.stderr}")
            
    except Exception as e:
        raise Exception(f"Failed to process DICOM with Python 3.11: {str(e)}")

def cleanup_old_files():
    """Delete old processed PNG folders and upload files"""
    # Clean up processed PNG folders - look in both backend and project root directories
    png_dirs = ["Processed_PNGs", "Processed_PNGs_cropped"]
    
    # Check in backend directory (current behavior)
    for dir_name in png_dirs:
        backend_dir_path = os.path.join(os.path.dirname(__file__), dir_name)
        if os.path.exists(backend_dir_path):
            shutil.rmtree(backend_dir_path)
            print(f"Deleted old directory: {backend_dir_path}")
    
    # Check in project root directory (where they should be)
    for dir_name in png_dirs:
        root_dir_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), dir_name)
        if os.path.exists(root_dir_path):
            shutil.rmtree(root_dir_path)
            print(f"Deleted old directory: {root_dir_path}")
    
    # Clean up uploads folder
    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
                print(f"Deleted old upload: {file_path}")
    
    # Recreate uploads directory
    os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload-dcm")
async def upload_dcm(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dcm"):
        raise HTTPException(status_code=400, detail="Only .dcm files are supported")

    # Clean up old processed folders and uploads
    cleanup_old_files()
    
    # Save new DICOM file
    dest_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(dest_path, "wb") as out:
        shutil.copyfileobj(file.file, out)

    # Process using Python 3.11 with correct package versions
    try:
        raw_count, cropped_count = await asyncio.to_thread(process_dcm_with_python311, dest_path)
        return JSONResponse({
            "message": "DICOM processed successfully with Python 3.11",
            "raw_files_count": raw_count,
            "cropped_files_count": cropped_count,
            "raw_files": [f"Processed_PNGs/{file}" for file in os.listdir("Processed_PNGs") if file.endswith('.png')],
            "cropped_files": [f"Processed_PNGs_cropped/{file}" for file in os.listdir("Processed_PNGs_cropped") if file.endswith('.png')]
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process DICOM: {str(e)}")

@app.post("/reset")
async def reset():
    """Reset endpoint: clean up all folders and stop processing"""
    try:
        cleanup_old_files()
        return JSONResponse({
            "message": "Reset completed successfully",
            "status": "success"
        })
    except Exception as e:
        return JSONResponse({
            "message": f"Reset failed: {str(e)}",
            "status": "error"
        }, status_code=500)
