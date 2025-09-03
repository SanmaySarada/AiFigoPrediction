from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
import sys
import os
import asyncio
import base64
from io import BytesIO
from PIL import Image
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

@app.post("/process_image")
async def process_image(data: dict):
    """
    Receive processed images from Jupyter notebook
    Expected payload: {"image": "base64_encoded_image", "filename": "image_name.png"}
    """
    try:
        # Extract data from request
        image_base64 = data.get("image")
        filename = data.get("filename", "processed_image.png")
        
        if not image_base64:
            raise HTTPException(status_code=400, detail="No image data provided")
        
        # Decode base64 image
        image_data = base64.b64decode(image_base64)
        
        # Create a directory for processed images if it doesn't exist
        processed_dir = os.path.join(os.path.dirname(__file__), "processed_images")
        os.makedirs(processed_dir, exist_ok=True)
        
        # Save the image
        image_path = os.path.join(processed_dir, filename)
        with open(image_path, "wb") as f:
            f.write(image_data)
        
        # You can add your AI processing logic here
        # For now, we'll just return success with image info
        image = Image.open(BytesIO(image_data))
        
        return JSONResponse({
            "message": "Image processed successfully",
            "filename": filename,
            "image_path": image_path,
            "image_size": image.size,
            "image_mode": image.mode,
            "status": "success"
        })
        
    except Exception as e:
        return JSONResponse({
            "message": f"Failed to process image: {str(e)}",
            "status": "error"
        }, status_code=500)
