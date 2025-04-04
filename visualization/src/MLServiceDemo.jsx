import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Timer, AlertCircle, Terminal, X, RefreshCw } from 'lucide-react';
import axios from 'axios';
import './MLServiceDemo.css';

const MLServiceDemo = () => {
    const [pods, setPods] = useState([]);
    const [results, setResults] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [lastProcessTime, setLastProcessTime] = useState(null);
    const [commands, setCommands] = useState([]);
    const [lastRefreshTime, setLastRefreshTime] = useState(null);
    const [minReplicas, setMinReplicas] = useState(1);
    const [maxReplicas, setMaxReplicas] = useState(1);
    
    const fileInputRef = useRef(null);
    const commandsEndRef = useRef(null);

    const addCommand = useCallback((command, output = '') => {
        const timestamp = new Date().toLocaleTimeString();
        setCommands(prev => {
            const newCommands = [...prev, { timestamp, command, output }];
            return newCommands;
        });
        setTimeout(() => {
            commandsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }, []);

    // Get pods status
    const fetchPods = useCallback(async () => {
        try {
            const response = await axios.get('/api/pods');
            const podData = response.data.items.filter(pod => pod.metadata.name.match(/^ml-service-.*$/)).map(pod => {
                const conditions = pod.status.conditions || [];
                const readyCondition = conditions.find(condition => condition.type === 'Ready');
                const isReady = readyCondition ? readyCondition.status === 'True' : false;
                return {
                    id: pod.metadata.name,
                    status: pod.metadata.deletionTimestamp ? 'terminating' : pod.status.phase.toLowerCase(),
                    isReady,
                    timestamp: new Date(pod.metadata.creationTimestamp).getTime()
                };
            });
            setPods(podData);
            setLastRefreshTime(new Date().toLocaleTimeString());
        } catch (error) {
            console.error('Error fetching pods:', error);
            addCommand('$ kubectl get pods', `Error: ${error.message}`);
        }
    }, [addCommand]);

    // Shut down a pod
    const deletePod = useCallback(async (podId) => {
        try {
            addCommand(`$ kubectl delete pod ${podId}`);
            const response = await axios.delete(`/api/pods/${podId}`);
            fetchPods();
        } catch (error) {
            console.error('Error deleting pod:', error);
            addCommand(`$ kubectl delete pod ${podId}`, `Error: ${error.message}`);
        }
    }, [fetchPods, addCommand]);

    useEffect(() => {
        fetchPods();
        const interval = setInterval(fetchPods, 5000);
        return () => clearInterval(interval);
    }, [fetchPods]);
    

    // Call the Python script to process images
    const processImages = useCallback(async (files) => {
        setProcessing(true);
        const startTime = performance.now();

        try {
            const fileArray = Array.from(files);
            const fileNames = fileArray.map(file => file.name);
            const response = await axios.post('/api/process-images', { fileNames });
            const newResults = response.data.results.map(result => {
                const file = fileArray.find(file => file.name === result.filename);
                return {
                    ...result,
                    imageUrl: file ? URL.createObjectURL(file) : ''
                };
            });
            setResults(prev => [...newResults, ...prev]);

            const endTime = performance.now();
            const processTime = (endTime - startTime).toFixed(0);
            setLastProcessTime(processTime);

            // Get the processed messages count for each pod
            const podMessageCounts = newResults.reduce((acc, result) => {
                acc[result.processingPod] = (acc[result.processingPod] || 0) + 1;
                return acc;
            }, {});

            // Update the command output with the process time and message counts
            const commandOutput = `Process time: ${processTime}ms\n` +
                Object.entries(podMessageCounts).map(([pod, count]) => `${pod}: ${count} msgs`).join('\n');

            addCommand(``, commandOutput);
        } catch (error) {
            addCommand(`$ python client.py ${Array.from(files).map(file => file.name).join(' ')}`, `Error: ${error.message}`);
            console.error('Error processing images:', error);
        } finally {
            setProcessing(false);
            // Adjust the replicas back to minReplicas after processing
            if (minReplicas !== maxReplicas) {
                updateReplicas(minReplicas, minReplicas);
            }
        }
    }, [addCommand, minReplicas]);

    // Handle file upload
    const handleFileUpload = useCallback((event) => {
        const files = event.target.files;
        if (files.length > 0) {
            setResults([]);
            // Adjust the replicas to maxReplicas while processing
            if (maxReplicas !== minReplicas) {
                updateReplicas(maxReplicas, maxReplicas);
            }
            processImages(files);
            // Reset the file input
            event.target.value = null;
        }
    }, [processImages, maxReplicas]);

    const handleMinReplicasChange = (event) => {
        setMinReplicas(event.target.value);
    };

    const handleMaxReplicasChange = (event) => {
        setMaxReplicas(event.target.value);
    };

    // Update minReplicas and maxReplicas
    const updateReplicas = async (min, max) => {
        try {
            const response = await axios.post('/api/update-replicas', { minReplicas: min, maxReplicas: max });
            addCommand(`$ helm upgrade --set autoscaling.minReplicas=${min},autoscaling.maxReplicas=${max} ml-service ../server/ml-service`, ``);
        } catch (error) {
            addCommand(`$ helm upgrade --set autoscaling.minReplicas=${min},autoscaling.maxReplicas=${max} ml-service ../server/ml-service`, `Error: ${error.message}`);
            console.error('Error updating replicas:', error);
        }
    };
    React.useEffect(() => {
        return () => {
            results.forEach(result => {
                if (result.imageUrl) {
                    URL.revokeObjectURL(result.imageUrl);
                }
            });
        };
    }, [results]);

    return (
        <div className="container">
            {/* Control panel */}
            <div className="header">
                <h1>ML Service Demo</h1>
            </div>

            <div className="refresh-time">
                <h4>
                    Last Refresh Time: {lastRefreshTime ? lastRefreshTime : 'No refresh yet'} 
                </h4>
            </div>

            {/* Main grid */}
            <div className="main-grid">
                {/* Left side panel */}
                <div>
                    
                    {/* Pods visualization */}
                    <div className="pods-visualization">
                        <div className="pods-container">
                            {pods.map((pod) => (
                                <motion.div
                                    key={pod.id}
                                    initial={{ scale: 0.8 }}
                                    animate={{ 
                                        scale: 1,
                                        transition: { type: "spring", stiffness: 300, damping: 20 }
                                    }}
                                    onClick={() => deletePod(pod.id)}
                                    className={`pod ${pod.isReady ? 'pod-ready' : 'pod-not-ready'}`}
                                >
                                    <div>Pod {pod.id}</div>
                                    <div className="pod-status">{pod.status}</div>
                                    <div className="pod-timestamp">
                                        {new Date(pod.timestamp).toLocaleTimeString()}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Upload control */}
                    <div className="upload-container">
                        <input
                            type="file"
                            id="file-upload"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            className="hidden-file-input"
                            multiple
                            accept="image/*"
                        />
                    </div>

                    <label htmlFor="file-upload" className={`upload-button ${processing ? 'upload-button-disabled' : ''}`}>
                        <Upload size={20} />
                        {processing ? 'Processing...' : 'Upload Images'}
                    </label>
                    {lastProcessTime && (
                        <div className="last-process-time">
                            <Timer size={16} />
                            Process time: {lastProcessTime}ms
                        </div>
                    )}

                    {/* The input controls for min and max replicas */}
                    <div className="replica-controls">
                        <label>
                            Min Replicas:
                            <input
                                type="number"
                                value={minReplicas}
                                onChange={handleMinReplicasChange}
                                min="1"
                            />
                        </label>
                        <label>
                            Max Replicas:
                            <input
                                type="number"
                                value={maxReplicas}
                                onChange={handleMaxReplicasChange}
                                min="1"
                            />
                        </label>
                        <button onClick={() => updateReplicas(minReplicas, maxReplicas)}>Update Replicas</button>
                    </div>
                    
                    {/* Command line output */}
                    <div className="command-line">
                        <div className="command-line-output">
                            {commands.map((cmd, index) => (
                                <div key={index} className="command">
                                    <span className="command-timestamp">{cmd.timestamp}</span>
                                    <span className="command-text">{cmd.command}</span>
                                    {cmd.output && (
                                        <div
                                            className="command-output"
                                            dangerouslySetInnerHTML={{ __html: cmd.output.replace(/\n/g, '<br />') }}
                                        />
                                    )}
                                </div>
                            ))}
                            <div ref={commandsEndRef} />
                        </div>
                    </div>
                </div>

                {/* Right side panel: process results */}
                <div>
                    <div className="results-container">
                        {results.map((result, index) => (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="result-item"
                            >
                                <div className="result-content">
                                    <div className="result-image">
                                        <img
                                            src={result.imageUrl}
                                            alt={result.filename}
                                            className="max-w-full h-auto"
                                        />
                                    </div>
                                    <div className="result-info">
                                        <div className="result-header">
                                            <div className="result-filename">{result.filename}</div>
                                            <div className="result-time">{result.time}</div>
                                        </div>
                                        <div className="result-details">
                                            <div className="result-class">Class: {result.class}</div>
                                            <div className="result-confidence">Confidence: {result.confidence}</div>
                                            <div className="result-pod">Pod: {result.processingPod}</div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                        {results.length === 0 && (
                            <div className="no-results">
                                <AlertCircle size={20} />
                                No results yet. Upload some images to start.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MLServiceDemo;