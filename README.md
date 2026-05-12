# BloomOulu

BloomOulu by Team Meraki: a web platform for the Oulu Botanical Garden that unifies plant adoption, an AI plant guide, and QR exploration into one product. Growth Hack 2026, University of Oulu.

## Demo design

A reference demo lives in [`demo-design/`](./demo-design/). It is a self-contained static prototype (HTML + Babel-standalone React, no build step) generated from the Claude Design handoff bundle. The real frontend will be built separately and will differ — this folder exists purely as a visual / interaction reference.

To preview locally:

```
python3 -m http.server 8000
# then open http://localhost:8000/demo-design/
```

Deployed at the site root, `/` redirects to `/demo-design/`.
