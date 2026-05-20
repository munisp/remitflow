package httpapi.authz

default allow = false

allow {
    input.method == "GET"
    input.path = ["admin"]
    input.user == "admin"
}
