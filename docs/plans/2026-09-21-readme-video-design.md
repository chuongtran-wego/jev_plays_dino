# README Video Demo Design

## Goal

Show the existing Jev Plays Dino recording as an inline, playable video near
the top of the GitHub README without adding the 41 MB source recording to Git
history.

## Design

Transcode `docs/jev_plays_dino.mov` to an H.264 MP4 with browser-compatible
pixel formatting and a file size below GitHub's 10 MB free-plan upload limit.
Upload that MP4 as a GitHub-hosted attachment, then add a `Demo` section below
the README introduction with the attachment URL in its own paragraph so GitHub
renders the native video player. Keep the existing screenshot immediately
after the demo as a static fallback and repository preview.

The source MOV and temporary MP4 remain local artifacts and are not committed.
Verification covers the encoded file's codec and size, Markdown formatting,
the rendered GitHub README, and the remote `main` commit.
