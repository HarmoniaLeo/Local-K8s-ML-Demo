import os
import json
import base64
import redis
import tensorflow as tf
import numpy as np
from PIL import Image
import io
from flask import Flask, jsonify

app = Flask(__name__)

# Load models
CHECKPOINT_PATH = "checkpoints"
FOLDS = 6
CHECKPOINT_HASH = "cba453d59caed5b3ee49756d103e4a3c"    # Replace the hash of the model you need here
models = []
for fold in range(FOLDS):
    model = tf.keras.models.load_model(os.path.join(CHECKPOINT_PATH, f"{CHECKPOINT_HASH}_{fold}.keras"))
    models.append(model)

# The ensemble prediction of models trained on different folds
def ensemble_predict(models, X_test):
    predictions = [model.predict(X_test) for model in models]
    stacked_predictions = np.stack(predictions, axis=0)
    avg_predictions = np.mean(stacked_predictions, axis=0)
    return avg_predictions

CLASSES = ["お", "き", "す", "つ", "な", "は", "ま", "や", "れ", "を"]

def process_image(image_data: bytes) -> dict:
    """Preprocess and predict a single image"""
    img = Image.open(io.BytesIO(image_data))
    img = img.resize((28, 28))
    img_array = tf.keras.preprocessing.image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)
    predictions = ensemble_predict(models, img_array)
    predicted_class = CLASSES[np.argmax(predictions)]
    confidence = np.max(predictions)
    return {"class": predicted_class, "confidence": float(confidence)}

# The Readiness probe is mainly responsible for checking whether the application has been connected to Redis
@app.route('/ready', methods=['GET'])
def readiness_probe():
    try:
        response = r.ping()
        if response:
            return jsonify({"status": "ready"}), 200
    except redis.ConnectionError:
        return jsonify({"status": "not ready"}), 500

@app.route('/health', methods=['GET'])
def health_probe():
    return jsonify({"status": "healthy"}), 200

def main():
    global r
    # The port of the Redis service has been set in server/redis/values.yaml
    r = redis.Redis(host="my-redis-master", port=6379, db=0)

    # Test whether the connection to Redis has been successfully established
    try:
        response = r.ping()
        print("Connected to Redis:", response)
    except redis.ConnectionError as e:
        print("Failed to connect to Redis:", e)

    # Retrieve the current Pod name
    pod_name = os.getenv('HOSTNAME', 'unknown')

    # Create Redis Stream (if not exists)
    if not r.exists("image_stream"):
        print("Creating image_stream...")
        r.xgroup_create("image_stream", "image_processing_group", id="0", mkstream=True)
    if not r.exists("result_stream"):
        print("Creating result_stream...")
        r.xgroup_create("result_stream", "image_processing_group", id="0", mkstream=True)

    print("Waiting for messages...")

    while True:
        # Read messages from image_stream
        messages = r.xreadgroup(
            groupname="image_processing_group",
            consumername=pod_name,
            streams={"image_stream": ">"},
            count=1,
            block=0
        )

        if messages:
            for stream, messages in messages:
                for message_id, data in messages:
                    message_data = json.loads(data[b'data'])
                    image_data = base64.b64decode(message_data['image_data'])
                    result = process_image(image_data)
                    result['filename'] = message_data['filename']
                    result['processingPod'] = pod_name  # Add Pod name to the results
                    print(f"Processed image {result['filename']} in pod {pod_name}: {result}")

                    # Write the result to result_stream
                    r.xadd("result_stream", {"data": json.dumps(result)})

                    # Confirm that the message has been processed
                    r.xack("image_stream", "image_processing_group", message_id)

if __name__ == "__main__":
    from threading import Thread
    server_thread = Thread(target=main)
    server_thread.start()
    app.run(host='0.0.0.0', port=5000)