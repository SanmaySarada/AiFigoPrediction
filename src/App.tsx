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
  Description as FileTextIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material'
import { useDropzone } from 'react-dropzone'
import './App.css'

interface PredictionResult {
  filePrediction: number | null
  numericalPrediction: number | null
  finalResult: number | null
  confidence: number | null
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
          setProcessedFiles(result)
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
    setNumericalInputs(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const validateInputs = () => {
    if (!file && Object.values(numericalInputs).some(val => !val)) {
      setError('Please provide either a file or all three numerical inputs')
      return false
    }
    if (file && Object.values(numericalInputs).some(val => !val)) {
      setError('Please provide both a file and all three numerical inputs')
      return false
    }
    
    // Validate input2 is 'y' or 'n' (case insensitive)
    if (numericalInputs.input2 && !/^[ynYN]$/.test(numericalInputs.input2)) {
      setError('previa_yes/no must be either "y" or "n"')
      return false
    }
    
    // Validate input1 is a whole number
    if (numericalInputs.input1 && (!Number.isInteger(Number(numericalInputs.input1)) || Number(numericalInputs.input1) < 0)) {
      setError('number_prior_cs must be a whole number (0 or positive integer)')
      return false
    }
    
    // Validate input3 is an integer
    if (numericalInputs.input3 && !Number.isInteger(Number(numericalInputs.input3))) {
      setError('cnn_pred must be an integer value')
      return false
    }
    
    return true
  }

  const simulatePrediction = async () => {
    // Simulate API calls to AI models
    return new Promise<PredictionResult>((resolve) => {
      setTimeout(() => {
        const filePrediction = file ? Math.random() * 100 : null
        
        // Convert y/n input to binary value (y=1, n=0) for calculations
        const yNoValue = numericalInputs.input2 ? (numericalInputs.input2.toLowerCase() === 'y' ? 1 : 0) : null
        const numericalPrediction = Object.values(numericalInputs).every(val => val) 
          ? Math.random() * 100 
          : null
        
        let finalResult = 0
        let confidence = 0
        
        if (filePrediction !== null && numericalPrediction !== null) {
          // Combine both predictions with weighted average
          finalResult = (filePrediction * 0.6) + (numericalPrediction * 0.4)
          confidence = Math.random() * 0.3 + 0.7 // 70-100% confidence
        } else if (filePrediction !== null) {
          finalResult = filePrediction
          confidence = Math.random() * 0.2 + 0.6 // 60-80% confidence
        } else if (numericalPrediction !== null) {
          finalResult = numericalPrediction
          confidence = Math.random() * 0.2 + 0.6 // 60-80% confidence
        }
        
        resolve({
          filePrediction,
          numericalPrediction,
          finalResult,
          confidence
        })
      }, 2000)
    })
  }

  const handlePredict = async () => {
    if (!validateInputs()) return
    
    setIsProcessing(true)
    setError(null)
    
    try {
      const result = await simulatePrediction()
      setPredictionResult(result)
    } catch (err) {
      setError('An error occurred during prediction. Please try again.')
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
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box textAlign="center" mb={4}>
        <Typography variant="h3" component="h1" gutterBottom color="primary">
          Placenta Accreta Spectrum Figo AI Prediction Engine
        </Typography>
      </Box>

      <Stack spacing={4}>
        {/* File Upload and Numerical Input Sections */}
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {/* File Upload Section */}
          <Paper elevation={3} sx={{ p: 3, flex: 1, minWidth: 300 }}>
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
          <Paper elevation={3} sx={{ p: 3, flex: 1, minWidth: 300 }}>
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
                helperText="Enter 'y' for yes or 'n' for no"
              />
              <TextField
                fullWidth
                label="cnn_pred"
                type="number"
                value={numericalInputs.input3}
                onChange={(e) => handleNumericalInputChange('input3', e.target.value)}
                placeholder="Enter integer value"
                InputProps={{
                  inputProps: { step: 1 }
                }}
              />
            </Stack>
          </Paper>
        </Box>

        {/* Action Buttons */}
        <Box textAlign="center">
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button
              variant="contained"
              size="large"
              onClick={handlePredict}
              disabled={isProcessing || (!file && Object.values(numericalInputs).some(val => !val))}
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
          <Paper elevation={3} sx={{ p: 3 }}>
            <Box textAlign="center" mb={3}>
              <Typography variant="h4" component="h2" gutterBottom color="primary">
                Prediction Results
              </Typography>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
              {predictionResult.filePrediction !== null && (
                <Card sx={{ minWidth: 250, flex: 1 }}>
                  <CardContent>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      File Analysis Result
                    </Typography>
                    <Typography variant="h4" color="primary">
                      {predictionResult.filePrediction.toFixed(2)}
                    </Typography>
                    <Chip 
                      label="File-based prediction" 
                      color="primary" 
                      variant="outlined" 
                      size="small" 
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>
              )}
              
              {predictionResult.numericalPrediction !== null && (
                <Card sx={{ minWidth: 250, flex: 1 }}>
                  <CardContent>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      Parameter Analysis Result
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      number_prior_cs: {numericalInputs.input1}<br/>
                      previa_yes/no: {numericalInputs.input2}<br/>
                      cnn_pred: {numericalInputs.input3}
                    </Typography>
                    <Typography variant="h4" color="secondary">
                      {predictionResult.numericalPrediction.toFixed(2)}
                    </Typography>
                    <Chip 
                      label="Parameter-based prediction" 
                      color="secondary" 
                      variant="outlined" 
                      size="small" 
                      sx={{ mt: 1 }}
                    />
                  </CardContent>
                </Card>
              )}
              
              <Card sx={{ minWidth: 250, flex: 1, bgcolor: 'success.50' }}>
                <CardContent>
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    Final Combined Result
                  </Typography>
                  <Typography variant="h3" color="success.main" fontWeight="bold">
                    {predictionResult.finalResult.toFixed(2)}
                  </Typography>
                  <Chip 
                    label={`${(predictionResult.confidence! * 100).toFixed(0)}% confidence`}
                    color="success" 
                    sx={{ mt: 1 }}
                  />
                </CardContent>
              </Card>
            </Box>
            
            <Box mt={3} p={2} bgcolor="info.50" borderRadius={1}>
              <Typography variant="body2" color="info.main">
                <strong>Analysis Summary:</strong> The final prediction combines both the file analysis 
                and numerical parameter analysis using advanced AI algorithms. The confidence score 
                indicates the reliability of this combined prediction.
              </Typography>
            </Box>
          </Paper>
        )}
      </Stack>
    </Container>
  )
}

export default App
