# NetPulse

A Chrome Manifest V3 extension that keeps a fixed wireless connection lightly active, watches YouTube playback, and records short-term stability signals.

NetPulse is an independent project inspired by the original Z Pinger concept. It uses its own name, branding, icon set, and implementation while keeping the same broad idea: lightweight connection warming and stability visibility.

## What it does

- Sends small cache-busted HTTPS requests on a schedule.
- Rotates through Dialog, Google, YouTube, and Cloudflare probe endpoints.
- Watches YouTube playback and backs off while video is playing.
- Runs one tiny rescue probe only when YouTube reports buffering or a stall.
- Adds browser preconnect hints for YouTube, `ytimg.com`, and detected `googlevideo.com` CDN hosts.
- Tracks successful probes, failed probes, average response time, loss percentage, and failure streaks.
- Supports custom probe URLs for other ISPs.
- Uses Chrome alarms, so background probing is intentionally limited to 30 seconds or slower.

## Install

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the cloned `NetPulse` extension folder.

## Recommended YouTube setup

| Setting | Value |
| --- | --- |
| Profile | YouTube helper |
| Interval | 60 seconds |
| Probe burst | 1 request |
| YouTube assist | On |
| Rescue cooldown | 30 seconds |

## What it cannot do

This extension cannot override ISP congestion, tower load, Dialog traffic shaping, weak SINR/RSRQ, router firmware issues, or YouTube CDN routing. It can help with idle-link stalls, DNS/session warm-up, NAT timeouts, and quick visibility into whether your link is degrading.

## Best starting profiles

| Network | Profile | Interval | Probe burst | YouTube assist | Rescue cooldown | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Dialog HBB / Outdoor HBB | YouTube helper | 60 seconds | 1 request | On | 30 seconds | Best for your current YouTube lag case during peak time. |
| Dialog general browsing | Dialog HBB | 60 seconds | 1 request | On | 30 seconds | Use 30 seconds only if the connection goes idle/stale often. |
| Hutch | Hutch | 60 seconds | 1 request | On | 30 seconds | Use Balanced if Hutch endpoints fail but browsing works. |
| Mobitel | Mobitel | 60 seconds | 1 request | On | 30 seconds | Good for SLT-Mobitel mobile/fixed wireless routes. |
| Airtel | Airtel | 60 seconds | 1 request | On | 30 seconds | Keep this gentle on low-bandwidth cells. |
| SLT Fiber / stable wired | SLT / Fiber | 120 seconds | 1 request | On | 60 seconds | Less warming needed on wired/fiber links. |
| Unknown ISP / VPN | Balanced | 60 seconds | 1 request | On | 30 seconds | Uses neutral Google/Cloudflare checks. |

If the video buffer is below 5 seconds, keep probe burst at **1 request**. If the connection is stable but often goes idle, try **30 seconds** interval. If the video gets worse when NetPulse is on, use **120 seconds** interval or turn it off for that session.

## Privacy

NetPulse stores settings and probe history locally in Chrome extension storage. It does not collect analytics, send telemetry, or upload browsing history to a server.

## Attribution

This project was inspired by the original Z Pinger app/extension idea. NetPulse is a separate, independently branded implementation and is not affiliated with the original project.
