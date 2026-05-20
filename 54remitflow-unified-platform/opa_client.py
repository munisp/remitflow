import requests

# Example usage:
# Check if a user is authorized to access a resource
input_data = {
    "input": {
        "method": "GET",
        "path": ["admin"],
        "user": "admin"
    }
}

response = requests.post("http://localhost:8181/v1/data/httpapi/authz/allow", json=input_data)

if response.json()["result"]:
    print("User is authorized")
else:
    print("User is not authorized")
