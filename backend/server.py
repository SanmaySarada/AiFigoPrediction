from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
import sys
import os
import asyncio
import subprocess
import pickle
import numpy as np
from PIL import Image
import tensorflow as tf
sys.path.append(os.path.dirname(__file__))

app = FastAPI(title="Figo AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Load models on startup"""
    load_models()

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Load the CNN model and ensemble model
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
CNN_MODEL_PATH = os.path.join(MODEL_DIR, "best_model_copy.h5")
ENSEMBLE_MODEL_PATH = os.path.join(MODEL_DIR, "ensemble.pkl")

# Global variables to store loaded models
cnn_model = None
ensemble_model = None

def load_models():
    """Load the CNN and ensemble models"""
    global cnn_model, ensemble_model
    try:
        if os.path.exists(CNN_MODEL_PATH):
            # Try loading with custom_objects to handle compatibility issues
            cnn_model = tf.keras.models.load_model(CNN_MODEL_PATH, compile=False)
            print(f"CNN model loaded successfully from {CNN_MODEL_PATH}")
            print(f"Model input shape: {cnn_model.input_shape}")
            print(f"Model output shape: {cnn_model.output_shape}")
        else:
            print(f"CNN model file not found at {CNN_MODEL_PATH}")
        
        if os.path.exists(ENSEMBLE_MODEL_PATH):
            with open(ENSEMBLE_MODEL_PATH, 'rb') as f:
                ensemble_model = pickle.load(f)
            print(f"Ensemble model loaded successfully from {ENSEMBLE_MODEL_PATH}")
            print(f"Available models in ensemble: {list(ensemble_model.keys())}")
        else:
            print(f"Ensemble model file not found at {ENSEMBLE_MODEL_PATH}")
    except Exception as e:
        print(f"Error loading models: {e}")
        print("Will use fallback prediction logic")

def predict_cnn_values(cropped_image_paths):
    """Use CNN model to predict cnn_pred values from all cropped images"""
    global cnn_model
    
    print(f"CNN model loaded: {cnn_model is not None}")
    print(f"Number of cropped images: {len(cropped_image_paths) if cropped_image_paths else 0}")
    
    if not cnn_model:
        print("CNN model failed to load - returning error")
        return {"error": "CNN model failed to load. Please check model compatibility."}
    
    if not cropped_image_paths or len(cropped_image_paths) == 0:
        return {"error": "No cropped images available for CNN prediction."}
    
    try:
        predictions = []
        individual_predictions = []  # Store individual predictions for debugging
        
        # Process each cropped image
        for i, img_path in enumerate(cropped_image_paths):
            if not os.path.exists(img_path):
                print(f"Image {i+1} not found: {img_path}")
                continue
                
            print(f"Processing image {i+1}: {os.path.basename(img_path)}")
            
            # Load and preprocess image
            img = Image.open(img_path).convert('RGB')
            img = img.resize((256, 256))  # Resize to match model input
            img_array = np.array(img) / 255.0  # Normalize
            img_array = np.expand_dims(img_array, axis=0)  # Add batch dimension
            
            # Get CNN prediction
            prediction = cnn_model.predict(img_array, verbose=0)
            print(f"Raw prediction for image {i+1}: {prediction}")
            
            # Convert to float (keep continuous values for averaging)
            if len(prediction[0]) > 1:
                pred_value = float(np.argmax(prediction[0]))
            else:
                pred_value = float(prediction[0][0])
            
            predictions.append(pred_value)
            individual_predictions.append({
                "image": os.path.basename(img_path),
                "prediction": pred_value,
                "raw_prediction": prediction[0].tolist()
            })
            print(f"Image {i+1} ({os.path.basename(img_path)}) prediction: {pred_value}")
        
        if not predictions:
            return {"error": "No valid predictions generated from images."}
        
        # Average all predictions
        avg_prediction = float(np.mean(predictions))
        print(f"Individual predictions: {predictions}")
        print(f"Average CNN prediction from {len(predictions)} images: {avg_prediction}")
        
        return {
            "cnn_pred": avg_prediction,
            "individual_predictions": individual_predictions,
            "total_images_processed": len(predictions)
        }
        
    except Exception as e:
        print(f"Error in CNN prediction: {e}")
        import traceback
        traceback.print_exc()
        return {"error": f"CNN prediction failed: {str(e)}"}

def to_bin(x):
    """Helper to coerce previa to 0/1"""
    if isinstance(x, str):
        return 1 if x.strip().lower().startswith("y") else 0
    return int(x)

def predict_pas(number_prior_cs, previa, cnn_prob, threshold=0.5):
    """Single-patient prediction using ensemble model"""
    global ensemble_model
    
    if not ensemble_model:
        return {"error": "Ensemble model not loaded"}
    
    try:
        # Extract individual models from the bundle
        log_model = ensemble_model["log_model"]
        rf_model = ensemble_model["rf_model"]
        gb_model = ensemble_model["gb_model"]
        
        # Prepare input array
        x = np.array([[float(number_prior_cs), float(to_bin(previa)), float(cnn_prob)]], dtype=float)
        
        # Get predictions from all three models
        log_prob = log_model.predict_proba(x)[:,1]
        rf_prob = rf_model.predict_proba(x)[:,1]
        gb_prob = gb_model.predict_proba(x)[:,1]
        
        # Average the probabilities
        p = np.mean([log_prob, rf_prob, gb_prob], axis=0)[0]
        
        return {
            "prob": float(p),
            "pred": int(p >= threshold),
            "individual_predictions": {
                "logistic_regression": float(log_prob[0]),
                "random_forest": float(rf_prob[0]),
                "gradient_boosting": float(gb_prob[0])
            }
        }
        
    except Exception as e:
        print(f"Error in ensemble prediction: {e}")
        import traceback
        traceback.print_exc()
        return {"error": f"Ensemble prediction failed: {str(e)}"}

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

@app.post("/generate-cnn-prediction")
async def generate_cnn_prediction(request: dict):
    """Generate CNN prediction from cropped images"""
    try:
        cropped_files = request.get("cropped_files", [])
        if not cropped_files:
            return JSONResponse({"error": "No cropped files provided"}, status_code=400)
        
        # Get full paths to cropped files
        cropped_files_dir = "Processed_PNGs_cropped"
        full_paths = []
        for file in cropped_files:
            if file.startswith("Processed_PNGs_cropped/"):
                full_path = file
            else:
                full_path = os.path.join(cropped_files_dir, file)
            if os.path.exists(full_path):
                full_paths.append(full_path)
        
        if not full_paths:
            return JSONResponse({"error": "No valid cropped files found"}, status_code=400)
        
        # Generate CNN predictions
        result = predict_cnn_values(full_paths)
        return JSONResponse(result)
        
    except Exception as e:
        return JSONResponse({"error": f"Failed to generate CNN prediction: {str(e)}"}, status_code=500)

@app.post("/generate-ensemble-prediction")
async def generate_ensemble_prediction(request: dict):
    """Generate ensemble prediction from the three input values"""
    try:
        number_prior_cs = request.get("number_prior_cs")
        previa = request.get("previa")
        cnn_prob = request.get("cnn_prob")
        threshold = request.get("threshold", 0.5)
        
        if number_prior_cs is None or previa is None or cnn_prob is None:
            return JSONResponse({"error": "Missing required parameters: number_prior_cs, previa, cnn_prob"}, status_code=400)
        
        # Generate ensemble prediction
        result = predict_pas(number_prior_cs, previa, cnn_prob, threshold)
        return JSONResponse(result)
        
    except Exception as e:
        return JSONResponse({"error": f"Failed to generate ensemble prediction: {str(e)}"}, status_code=500)

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
