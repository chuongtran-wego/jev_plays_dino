FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY main.go main_test.go ./
COPY web ./web
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /jev-plays-dino .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /jev-plays-dino /jev-plays-dino
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/jev-plays-dino"]
