import os
import json
import base64
import redis
import sys

def send_images_to_redis(file_names):
    # Connect to Redis
    r = redis.Redis(host="localhost", port=54563, db=0) # Change the port number here to the port number exposed by the port mapping of the Redis service

    # Create Redis Stream (if not exists)
    if not r.exists("image_stream"):
        r.xgroup_create("image_stream", "image_processing_group", id="0", mkstream=True)
    if not r.exists("result_stream"):
        r.xgroup_create("result_stream", "image_processing_group", id="0", mkstream=True)

    images = []
    for file_name in file_names:
        file_path = os.path.join("imgs", file_name)
        with open(file_path, "rb") as image_file:
            # Read image data and encode it as Base64
            filename = os.path.basename(file_path)
            image_data = base64.b64encode(image_file.read()).decode("utf-8")
            message = {"filename": filename, "image_data": image_data}
            # Write message to Redis Stream
            r.xadd("image_stream", {"data": json.dumps(message)})
            images.append(filename)

    # Set timeout time (milliseconds)
    timeout = 30000  # 5 seconds

    # Wait for results
    while images:
        # Read messages from result_stream
        results = r.xreadgroup(
            groupname="image_processing_group",
            consumername="worker1",
            streams={"result_stream": ">"},
            count=1,
            block=timeout  # Wait for 5 seconds
        )

        if results:
            for stream, messages in results:
                for message_id, message_data in messages:
                    # Parse the message data
                    result = json.loads(message_data[b"data"])
                    if result["filename"] not in images:
                        continue
                    # Print the result to the console so the UI can display it
                    print(json.dumps(result))
                    # Remove the processed image from the list
                    images.remove(result["filename"])
                    # Acknowledge the message
                    r.xack("result_stream", "image_processing_group", message_id)
        else:
            # No results received within the timeout period
            break

if __name__ == "__main__":
    file_names = sys.argv[1:]
    send_images_to_redis(file_names)