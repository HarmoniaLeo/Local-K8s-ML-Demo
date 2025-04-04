const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const port = 3002;

app.use(express.json());

app.get('/api/pods', (req, res) => {
  // Get pods status
  exec('kubectl get pods -o json', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: stderr });
    }
    try {
      const jsonOutput = JSON.parse(stdout);
      res.json(jsonOutput);
    } catch (parseError) {
      console.error(`parse error: ${parseError}`);
      res.status(500).json({ error: 'Failed to parse JSON' });
    }
  });
});

app.delete('/api/pods/:name', (req, res) => {
  const podName = req.params.name;
  // Shutdown a pod
  exec(`kubectl delete pod ${podName} --grace-period=0 --force`, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: stderr });
    }
    res.json({ message: stdout });
  });
});

app.post('/api/process-images', (req, res) => {
  const { fileNames } = req.body;

  // Run the Python script with the provided image file names
  const command = `source activate KMNISTUI && python client.py ${fileNames.join(' ')}`;

  console.log('Executing Python script:', command);

  exec(command, (error, stdout, stderr) => {
      if (error) {
          console.error('Error executing Python script:', error);
          return res.status(500).json({ error: 'Error executing Python script' });
      }
      if (stderr) {
          console.error('Python script stderr:', stderr);
          return res.status(500).json({ error: 'Python script stderr' });
      }

      // Parse the JSON output from the Python script
      const results = stdout.split('\n').filter(line => line).map(line => JSON.parse(line));
      res.json({ results });
  });
});

app.post('/api/update-replicas', (req, res) => {
  const { minReplicas, maxReplicas } = req.body;

  // Adjust the ml-service replica count using Helm

  // const command = `helm upgrade --set autoscaling.minReplicas=${minReplicas},autoscaling.maxReplicas=${maxReplicas},scaledObject.minReplicaCount=${minReplicas},scaledObject.maxReplicaCount=${maxReplicas} ml-service ../server/ml-service`;
  const command = `helm upgrade --set autoscaling.minReplicas=${minReplicas},autoscaling.maxReplicas=${maxReplicas} ml-service ../server/ml-service`;

  console.log('Executing Helm command:', command);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error executing Helm command:', error);
      return res.status(500).json({ error: 'Error executing Helm command' });
    }
    if (stderr) {
      console.error('Helm command stderr:', stderr);
      return res.status(500).json({ error: 'Helm command stderr' });
    }

    res.json({ message: stdout });
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});