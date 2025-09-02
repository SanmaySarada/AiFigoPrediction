from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
import sys
import os
import asyncio
sys.path.append(os.path.dirname(__file__))
from process_dcm import process_single_dcm, cancel_event

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

def cleanup_old_files():
    """Delete old processed PNG folders and upload files"""
    # Clean up processed PNG folders - look in parent directory where process_dcm.py creates them
    png_dirs = ["Processed_PNGs", "Processed_PNGs_cropped"]
    for dir_name in png_dirs:
        dir_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), dir_name)
        if os.path.exists(dir_path):
            shutil.rmtree(dir_path)
            print(f"Deleted old directory: {dir_path}")
    
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

    # Clear any previous cancellation before starting
    cancel_event.clear()
    # Run CPU-bound processing in a background thread so reset can run concurrently
    raw_files, cropped_files = await asyncio.to_thread(process_single_dcm, dest_path)
    return JSONResponse({
        "raw_files": raw_files,
        "cropped_files": cropped_files
    })

@app.post("/reset")
async def reset():
    """Reset endpoint: clean up all folders and stop processing"""
    try:
        # Signal cancellation to any in-flight processing
        cancel_event.set()
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
