# Jupyter Notebook Workflow for DICOM Processing

This workflow allows you to process DICOM files in a Jupyter notebook environment (where you know the processing works correctly) and then send the results to your server endpoint.

## Why This Approach?

- **Consistent Processing**: Jupyter notebooks provide a stable environment where your original code works correctly
- **Visual Feedback**: You can see the processed images before sending them to the server
- **Debugging**: Easy to debug and modify processing parameters
- **Reliability**: Avoids environment differences between command-line and notebook execution

## Setup

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Start the Server**:
   ```bash
   cd backend
   python server.py
   ```

3. **Open the Jupyter Notebook**:
   ```bash
   jupyter notebook dicom_processor.ipynb
   ```

## Usage

1. **Update Configuration** in the notebook:
   - Set `DCM_PATH` to your DICOM file path
   - Set `SERVER_URL` to your server URL (default: `http://localhost:8000`)

2. **Run the Processing Cells**:
   - The notebook will process your DICOM file
   - Display the first cropped image for verification
   - Send all processed images to the server endpoint

3. **Check Results**:
   - The server will save received images to `backend/processed_images/`
   - You'll get a summary of successful/failed processing

## Workflow Steps

1. **DICOM Processing**: Uses your exact working code from the notebook
2. **Image Display**: Shows the processed image for verification
3. **Server Communication**: Sends base64-encoded images to `/process_image` endpoint
4. **Server Storage**: Server saves images and can run additional AI processing

## Endpoints

- `POST /process_image`: Receives processed images from Jupyter notebook
  - Payload: `{"image": "base64_encoded_image", "filename": "image_name.png"}`
  - Response: Processing status and image metadata

## Benefits

- ✅ **Consistent Results**: Same processing as your working Jupyter code
- ✅ **Visual Verification**: See images before sending to server
- ✅ **Flexible**: Easy to modify processing parameters
- ✅ **Reliable**: No environment differences
- ✅ **Scalable**: Can process multiple DICOM files in batch

## Example Output

```
🔄 Processing DICOM file...
✅ Wrote 1 raw PNG frames to jupyter_processed_raw
✅ Wrote 1 cropped PNGs to jupyter_processed_cropped
🔄 Sending images to server endpoint...
✅ Successfully processed PAS389_Abdtrans_3d3_frame_001.png

📊 Summary:
✅ Successfully processed: 1 images
❌ Failed: 0 images
```
