import { useState, useRef } from 'react'
import {
  Box,
  Container,
  Typography,
  Paper,
  TextField,
  Button,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Chip,
  Stack
} from '@mui/material'
import {
  Upload as UploadIcon,
  Calculate as CalculateIcon,
  Refresh as RefreshIcon,
  Description as FileTextIcon
} from '@mui/icons-material'
import { useDropzone } from 'react-dropzone'
import './App.css'

interface PredictionResult {
  filePrediction: number | null
  numericalPrediction: number | null
  finalResult: number | null
  confidence: number | null
  ensembleResult?: {
    prob: number
    pred: number
    individual_predictions: {
      logistic_regression: number
      random_forest: number
      gradient_boosting: number
    }
  }
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [numericalInputs, setNumericalInputs] = useState({
    input1: '',
    input2: '',
    input3: ''
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [predictionResult, setPredictionResult] = useState<PredictionResult>({
    filePrediction: null,
    numericalPrediction: null,
    finalResult: null,
    confidence: null
  })
  const [error, setError] = useState<string | null>(null)
  const [dicomProcessing, setDicomProcessing] = useState(false)
  const [processedFiles, setProcessedFiles] = useState<{raw_files: string[], cropped_files: string[]} | null>(null)
  const [isResetting, setIsResetting] = useState(false);
  const [isGeneratingCNN, setIsGeneratingCNN] = useState(false);
  const uploadAbortController = useRef<AbortController | null>(null)

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0]
      setFile(selectedFile)
      setError(null)
      
      // Process DICOM file through backend
      setDicomProcessing(true)
      try {
        const formData = new FormData()
        formData.append('file', selectedFile)
        const controller = new AbortController()
        uploadAbortController.current = controller

        const response = await fetch('http://localhost:8000/upload-dcm', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
        
        if (response.ok) {
          const result = await response.json()
          console.log('DICOM processed successfully:', result)
          console.log('Raw files:', result.raw_files)
          console.log('Cropped files:', result.cropped_files)
          
          // Set processed files with the correct structure
          setProcessedFiles({
            raw_files: result.raw_files || [],
            cropped_files: result.cropped_files || []
          })
          
          setError(null)
        } else {
          setError('Failed to process DICOM file')
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.log('Upload aborted')
        } else {
          console.error('Error processing DICOM:', err)
          setError('Error processing DICOM file')
        }
      } finally {
        setDicomProcessing(false)
        uploadAbortController.current = null
      }
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/dicom': ['.dcm'],
      'application/x-dicom': ['.dcm']
    },
    multiple: false
  })

  const handleNumericalInputChange = (field: string, value: string) => {
    // Don't allow changes to input3 (cnn_pred) - it's read-only
    if (field === 'input3') return;
    
    // For previa_yes/no field, only allow y, n, Y, N, or empty string
    if (field === 'input2') {
      // Only allow y, n, Y, N, or empty string
      if (value && !/^[ynYN]$/.test(value)) {
        return; // Don't update if invalid character
      }
      // Limit to 1 character
      if (value.length > 1) {
        return;
      }
    }
    
    setNumericalInputs(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleGenerateCNNPrediction = async () => {
    if (!processedFiles || !processedFiles.cropped_files || processedFiles.cropped_files.length === 0) {
      setError('No cropped images available for CNN prediction')
      return
    }

    setIsGeneratingCNN(true)
    setError(null)

    try {
      // Call the CNN prediction endpoint
      const response = await fetch('http://localhost:8000/generate-cnn-prediction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cropped_files: processedFiles.cropped_files
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.error) {
          setError(`CNN Prediction Failed: ${result.error}`)
        } else if (result.cnn_pred !== undefined) {
          setNumericalInputs(prev => ({
            ...prev,
            input3: result.cnn_pred.toString()
          }))
          console.log('CNN prediction generated:', result.cnn_pred)
          if (result.individual_predictions) {
            console.log('Individual predictions:', result.individual_predictions)
          }
        }
      } else {
        setError('Failed to generate CNN prediction')
      }
    } catch (err) {
      setError('Error generating CNN prediction')
    } finally {
      setIsGeneratingCNN(false)
    }
  }

  const validateInputs = () => {
    // All three fields must be filled out
    const hasInput1 = numericalInputs.input1 && numericalInputs.input1.trim() !== ''
    const hasInput2 = numericalInputs.input2 && numericalInputs.input2.trim() !== ''
    const hasInput3 = numericalInputs.input3 && numericalInputs.input3.trim() !== ''
    
    if (!hasInput1 || !hasInput2 || !hasInput3) {
      setError('Please fill out all three fields: number_prior_cs, previa_yes/no, and cnn_pred')
      return false
    }
    
    // Validate input2 is 'y' or 'n' (case insensitive)
    if (numericalInputs.input2 && !/^[ynYN]$/.test(numericalInputs.input2)) {
      setError('previa_yes/no must be either "y" or "n" (case insensitive)')
      return false
    }
    
    // Validate input1 is a whole number
    if (numericalInputs.input1 && (!Number.isInteger(Number(numericalInputs.input1)) || Number(numericalInputs.input1) < 0)) {
      setError('number_prior_cs must be a whole number (0 or positive integer)')
      return false
    }
    
    return true
  }

  const isGeneratePredictionDisabled = () => {
    // All three fields must be filled out: input1, input2, and input3
    const hasInput1 = numericalInputs.input1 && numericalInputs.input1.trim() !== ''
    const hasInput2 = numericalInputs.input2 && numericalInputs.input2.trim() !== ''
    const hasInput3 = numericalInputs.input3 && numericalInputs.input3.trim() !== ''
    
    // If any field is missing, disable
    if (!hasInput1 || !hasInput2 || !hasInput3) {
      return true
    }
    
    // Validate input2 is valid (y, n, Y, or N)
    if (numericalInputs.input2 && !/^[ynYN]$/.test(numericalInputs.input2)) {
      return true
    }
    
    // Validate input1 is a valid whole number
    if (numericalInputs.input1 && (!Number.isInteger(Number(numericalInputs.input1)) || Number(numericalInputs.input1) < 0)) {
      return true
    }
    
    return false
  }

  const generateEnsemblePrediction = async () => {
    try {
      const requestData = {
        number_prior_cs: parseFloat(numericalInputs.input1),
        previa: numericalInputs.input2,
        cnn_prob: parseFloat(numericalInputs.input3),
        threshold: 0.5
      }
      
      console.log('Sending ensemble prediction request:', requestData)
      
      const response = await fetch('http://localhost:8000/generate-ensemble-prediction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      })

      if (response.ok) {
        const result = await response.json()
        if (result.error) {
          throw new Error(result.error)
        }
        return result
      } else {
        throw new Error('Failed to generate ensemble prediction')
      }
    } catch (err) {
      console.error('Error generating ensemble prediction:', err)
      throw err
    }
  }

  const simulatePrediction = async () => {
    // Use real ensemble prediction instead of simulation
    try {
      const ensembleResult = await generateEnsemblePrediction()
      console.log('Ensemble result from backend:', ensembleResult)
      
      // Convert ensemble result to our prediction format
      const finalResult = ensembleResult.prob * 100 // Convert probability to percentage
      const confidence = ensembleResult.prob // Use actual probability as confidence - no artificial boost
      
      console.log('Converted values:', { finalResult, confidence, ensembleResult })
      
      return {
        filePrediction: null, // We don't have separate file prediction anymore
        numericalPrediction: null, // We don't have separate numerical prediction anymore
        finalResult,
        confidence,
        ensembleResult // Include the full ensemble result for debugging
      }
    } catch (err) {
      // Proper error handling - no random numbers for medical applications
      console.error('Ensemble prediction failed:', err)
      throw new Error('Prediction service is currently unavailable. Please try again later or contact support.')
    }
  }

  const handlePredict = async () => {
    if (!validateInputs()) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      const result = await simulatePrediction()
      setPredictionResult(result)
    } catch (err: any) {
      // Show specific error message from the prediction service
      setError(err.message || 'An error occurred during prediction. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReset = async () => {
    setIsResetting(true);
    try {
      if (uploadAbortController.current) {
        uploadAbortController.current.abort()
        uploadAbortController.current = null
      }
      const response = await fetch('http://localhost:8000/reset', {
        method: 'POST',
      });
      
      if (response.ok) {
        // Clear all state
        setFile(null);
        setNumericalInputs({
          input1: '',
          input2: '',
          input3: ''
        });
        setPredictionResult({
          filePrediction: null,
          numericalPrediction: null,
          finalResult: null,
          confidence: null
        });
        setError(null);
        setDicomProcessing(false);
        setProcessedFiles(null);
      } else {
        setError('Failed to reset. Please try again.');
      }
    } catch (err) {
      setError('Error during reset. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box textAlign="center" mb={4}>
        <Typography variant="h3" component="h1" gutterBottom color="primary">
          Placenta Accreta Spectrum Figo AI Prediction Engine
        </Typography>
      </Box>

      <Stack spacing={4} sx={{ width: '100%', alignItems: 'center' }}>
        {/* File Upload and Numerical Input Sections */}
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
          {/* File Upload Section */}
          <Paper elevation={3} sx={{ p: 3, flex: '0 1 520px', minWidth: 320, maxWidth: 560 }}>
            <Box textAlign="center" mb={3}>
              <FileTextIcon sx={{ fontSize: 48, color: '#1976d2' }} />
              <Typography variant="h5" component="h2" gutterBottom>
                DICOM File Analysis
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Upload your DICOM medical imaging file for AI analysis
              </Typography>
            </Box>
            
            <Box
              {...getRootProps()}
              sx={{
                border: '2px dashed',
                borderColor: isDragActive ? 'primary.main' : 'grey.300',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: isDragActive ? 'primary.50' : 'grey.50',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  backgroundColor: 'primary.50'
                }
              }}
            >
              <input {...getInputProps()} />
              <UploadIcon sx={{ fontSize: 32, color: '#666' }} />
              <Typography variant="h6" sx={{ mt: 2 }}>
                {isDragActive ? 'Drop the file here' : 'Drag & drop a file here'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                or click to select a file
              </Typography>
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                Supports DICOM files (.dcm)
              </Typography>
            </Box>
            
            {file && (
              <Box mt={2} p={2} bgcolor="success.50" borderRadius={1}>
                <Typography variant="body2" color="success.main">
                  ✓ File selected: {file.name}
                </Typography>
                {dicomProcessing && (
                  <Box mt={1} display="flex" alignItems="center" gap={1}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" color="success.main">
                      Processing DICOM file...
                    </Typography>
                  </Box>
                )}
                {processedFiles && (
                  <Box mt={2}>
                    <Typography variant="body2" color="success.main" fontWeight="bold">
                      ✓ DICOM processed successfully!
                    </Typography>
                    <Typography variant="caption" color="success.main" display="block">
                      Raw PNGs: {processedFiles.raw_files.length} files
                    </Typography>
                    <Typography variant="caption" color="success.main" display="block">
                      Cropped PNGs: {processedFiles.cropped_files.length} files
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </Paper>

          {/* Numerical Input Section */}
          <Paper elevation={3} sx={{ p: 3, flex: '0 1 520px', minWidth: 320, maxWidth: 560 }}>
            <Box textAlign="center" mb={3}>
              <CalculateIcon sx={{ fontSize: 48, color: '#1976d2' }} />
              <Typography variant="h5" component="h2" gutterBottom>
                Numerical Parameters
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enter three numerical values for prediction
              </Typography>
            </Box>
            
            <Stack spacing={3}>
              <TextField
                fullWidth
                label="number_prior_cs"
                type="number"
                value={numericalInputs.input1}
                onChange={(e) => handleNumericalInputChange('input1', e.target.value)}
                placeholder="Enter whole number"
                InputProps={{
                  inputProps: { step: 1, min: 0 }
                }}
              />
              <TextField
                fullWidth
                label="previa_yes/no"
                value={numericalInputs.input2}
                onChange={(e) => handleNumericalInputChange('input2', e.target.value)}
                placeholder="Enter 'y' or 'n'"
                inputProps={{
                  maxLength: 1,
                  pattern: '[ynYN]'
                }}
                helperText="Enter 'y' for yes or 'n' for no (only y, n, Y, or N allowed)"
                error={!!(numericalInputs.input2 && !/^[ynYN]$/.test(numericalInputs.input2))}
              />
              <TextField
                fullWidth
                label="cnn_pred (Generated by CNN)"
                type="number"
                value={numericalInputs.input3}
                placeholder={processedFiles ? "Click 'Generate CNN Prediction' button below" : "Upload DICOM file first"}
                InputProps={{
                  inputProps: { step: 1, readOnly: true },
                  style: { backgroundColor: '#f5f5f5' }
                }}
                helperText={processedFiles ? 
                  `Click the button below to analyze ${processedFiles.cropped_files.length} cropped images with CNN model` : 
                  "Upload a DICOM file to enable CNN prediction"
                }
              />
            </Stack>
          </Paper>
        </Box>

        {/* CNN Prediction Button - Show if DICOM is processed */}
        {processedFiles && processedFiles.cropped_files && processedFiles.cropped_files.length > 0 ? (
          <Box textAlign="center" mb={3} sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleGenerateCNNPrediction}
              disabled={isGeneratingCNN}
              startIcon={isGeneratingCNN ? <CircularProgress size={20} /> : null}
              sx={{ 
                minWidth: 300,
                backgroundColor: '#4caf50',
                '&:hover': {
                  backgroundColor: '#45a049'
                }
              }}
            >
              {isGeneratingCNN ? 'Generating CNN Prediction...' : 'Generate CNN Prediction'}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Analyze {processedFiles.cropped_files.length} cropped images with CNN model
            </Typography>
            {numericalInputs.input3 && (
              <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                ✓ CNN Prediction: {numericalInputs.input3}
              </Typography>
            )}
          </Box>
        ) : null}

        {/* Action Buttons */}
        <Box textAlign="center" sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button
              variant="contained"
              size="large"
              onClick={handlePredict}
              disabled={isProcessing || isGeneratePredictionDisabled()}
              startIcon={isProcessing ? <CircularProgress size={20} /> : null}
              sx={{ 
                minWidth: 200,
                backgroundColor: 'transparent',
                '&:hover': {
                  backgroundColor: 'transparent'
                }
              }}
            >
              {isProcessing ? 'Processing...' : 'Generate Prediction'}
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={handleReset}
              startIcon={<RefreshIcon />}
              sx={{ minWidth: 200 }}
              disabled={isResetting}
            >
              {isResetting ? <CircularProgress size={20} /> : 'Reset'}
            </Button>
          </Stack>
        </Box>

        {/* Error Display */}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Results Display */}
        {predictionResult.finalResult !== null && (
          <Paper elevation={3} sx={{ p: 3, width: '100%' }}>
            <Box textAlign="center" mb={3}>
              <Typography variant="h4" component="h2" gutterBottom color="primary">
                Prediction Results
              </Typography>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
              {/* Input Parameters Card */}
              <Card sx={{ minWidth: 250, flex: 1 }}>
                <CardContent>
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    Input Parameters
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    number_prior_cs: {numericalInputs.input1}<br/>
                    previa_yes/no: {numericalInputs.input2}<br/>
                    cnn_pred: {numericalInputs.input3}
                  </Typography>
                  <Chip 
                    label="Input values" 
                    color="primary" 
                    variant="outlined" 
                    size="small" 
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>

              {/* Ensemble Prediction Card */}
              <Card sx={{ minWidth: 250, flex: 1, bgcolor: 'success.50' }}>
                <CardContent>
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    Ensemble Prediction
                  </Typography>
                  <Typography variant="h3" color="success.main" fontWeight="bold">
                    {predictionResult.finalResult!.toFixed(1)}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Risk Level: {predictionResult.ensembleResult?.pred ? 'High Risk' : 'Low Risk'}
                  </Typography>
                  <Chip 
                    label={`${(predictionResult.ensembleResult?.prob || 0).toFixed(1)}% probability`}
                    color="success" 
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>

              {/* Individual Model Results Card */}
              {predictionResult.ensembleResult?.individual_predictions && (
                <Card sx={{ minWidth: 250, flex: 1 }}>
                  <CardContent>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      Individual Model Results
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Logistic Regression: {(predictionResult.ensembleResult.individual_predictions.logistic_regression * 100).toFixed(1)}%<br/>
                      Random Forest: {(predictionResult.ensembleResult.individual_predictions.random_forest * 100).toFixed(1)}%<br/>
                      Gradient Boosting: {(predictionResult.ensembleResult.individual_predictions.gradient_boosting * 100).toFixed(1)}%
                    </Typography>
                    <Chip 
                      label="Model breakdown" 
                      color="secondary" 
                      variant="outlined" 
                      size="small" 
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>
              )}
            </Box>
            
            <Box mt={3} p={2} bgcolor="info.50" borderRadius={1}>
              <Typography variant="body2" color="info.main">
                <strong>Analysis Summary:</strong> The ensemble prediction combines three machine learning models 
                (Logistic Regression, Random Forest, and Gradient Boosting) using your input parameters. 
                The final probability represents the risk assessment for Placenta Accreta Spectrum (PAS).
              </Typography>
            </Box>
          </Paper>
        )}
      </Stack>
    </Container>
  )
}

export default App
