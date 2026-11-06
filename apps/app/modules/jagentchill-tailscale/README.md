# JAgentChill embedded Tailscale module

This local Expo module embeds Tailscale's `tsnet` through the Go bridge under `go/tailscale-bridge`. The bridge keeps its node state in the app's private application directory and exposes a loopback TCP proxy to tailnet hosts. Auth keys are passed to native code for the join call and are not persisted by the app.

The iOS `JAgentChillTailscaleBridge.xcframework` is built from the checked-in Go bridge source with `gomobile bind`. Android Go/AAR build needs an Android NDK and is not included as a prebuilt binary.
